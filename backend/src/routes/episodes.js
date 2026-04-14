const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');
const { normalizeForTTS } = require('../utils/normalizeText');
const { spliceSegment } = require('../utils/stitchAudio');
const { getHostingAdapter } = require('../adapters/hosting');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const AUDIO_BUCKET = 'audio';

router.get('/', async (req, res) => {
  const orgId = req.user.organization.id;

  const episodes = await prisma.episode.findMany({
    where: { show: { organizationId: orgId } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      audioUrl: true,
      publishedUrl: true,
      characterCount: true,
      megaphoneEpisodeId: true,
      scheduledAt: true,
      createdAt: true,
      voice: { select: { name: true } },
    },
  });

  // Lazily flip scheduled → published for episodes whose pubdate has passed (or has no recorded pubdate)
  const now = new Date();
  const toFlip = episodes.filter(e => e.status === 'scheduled' && (!e.scheduledAt || new Date(e.scheduledAt) <= now));
  if (toFlip.length > 0) {
    await prisma.episode.updateMany({
      where: { id: { in: toFlip.map(e => e.id) } },
      data: { status: 'published' },
    });
    toFlip.forEach(e => { e.status = 'published'; });
  }

  res.json(episodes);
});

// GET /episodes/:id — fetch a single episode by ID
router.get('/:id', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;

  const episode = await prisma.episode.findUnique({
    where: { id },
    include: { show: true, voice: { select: { name: true } } },
  });

  if (!episode || episode.show.organizationId !== orgId) {
    return res.status(404).json({ error: 'Episode not found' });
  }

  res.json(episode);
});

// PATCH /episodes/:id — update title and/or description
router.patch('/:id', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;
  const { title, description } = req.body;

  const episode = await prisma.episode.findUnique({ where: { id }, include: { show: true } });
  if (!episode || episode.show.organizationId !== orgId) {
    return res.status(404).json({ error: 'Episode not found' });
  }

  const data = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;

  const updated = await prisma.episode.update({ where: { id }, data });
  res.json({ title: updated.title, description: updated.description });
});

// PATCH /episodes/:id/approve — approve and publish to Megaphone
router.patch('/:id/approve', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;

  const episode = await prisma.episode.findUnique({
    where: { id },
    include: { show: true },
  });

  if (!episode || episode.show.organizationId !== orgId) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  if (!episode.audioUrl) {
    return res.status(400).json({ error: 'Episode has no audio — generate audio first' });
  }
  if (episode.status === 'published') {
    return res.status(400).json({ error: 'Episode is already published' });
  }

  const megaphoneShowId = req.user.organization.megaphoneShowId;
  if (!megaphoneShowId) {
    return res.status(400).json({ error: 'Organization has no Megaphone show configured' });
  }

  // Mark approved first — if Megaphone fails we preserve the approval
  await prisma.episode.update({ where: { id }, data: { status: 'approved' } });

  try {
    const adapter = getHostingAdapter();
    const { id: megaphoneEpisodeId, url: publishedUrl } = await adapter.publishEpisode(
      megaphoneShowId,
      {
        title: episode.title,
        description: episode.description || '',
        audioUrl: episode.audioUrl,
        pubdate: new Date().toISOString(),
      }
    );

    const updated = await prisma.episode.update({
      where: { id },
      data: { status: 'published', megaphoneEpisodeId, publishedUrl },
    });

    res.json({ episodeId: updated.id, status: updated.status, publishedUrl });
  } catch (err) {
    console.error('Megaphone publish error:', err.message);
    res.status(500).json({
      error: `Published to Megaphone failed: ${err.message}. Episode marked approved — retry to publish.`,
      status: 'approved',
    });
  }
});

// DELETE /episodes/:id
router.delete('/:id', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;

  try {
    const episode = await prisma.episode.findUnique({
      where: { id },
      include: { show: true },
    });

    if (!episode || episode.show.organizationId !== orgId) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    // Best-effort: delete from Megaphone
    if (episode.megaphoneEpisodeId) {
      const megaphoneShowId = req.user.organization.megaphoneShowId;
      if (megaphoneShowId) {
        try {
          const adapter = getHostingAdapter();
          await adapter.deleteEpisode(megaphoneShowId, episode.megaphoneEpisodeId);
        } catch (err) {
          console.warn('Megaphone delete failed (continuing):', err.message);
        }
      }
    }

    // Best-effort: remove audio file from Supabase storage
    if (episode.audioUrl) {
      try {
        const url = new URL(episode.audioUrl);
        const storagePath = url.pathname.split('/audio/')[1];
        if (storagePath) await supabaseAdmin.storage.from('audio').remove([storagePath]);
      } catch { /* non-fatal */ }
    }

    await prisma.episode.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete episode error:', err.message);
    res.status(500).json({ error: 'Failed to delete episode' });
  }
});

// POST /episodes/:id/regenerate — re-run TTS with edited script text
router.post('/:id/regenerate', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;
  const { scriptText } = req.body;

  if (!scriptText?.trim()) {
    return res.status(400).json({ error: 'scriptText is required' });
  }

  const episode = await prisma.episode.findUnique({
    where: { id },
    include: {
      show: true,
      voice: true,
    },
  });

  if (!episode || episode.show.organizationId !== orgId) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  if (!episode.voice) {
    return res.status(400).json({ error: 'Episode has no voice set — cannot regenerate' });
  }

  const normalizedText = normalizeForTTS(scriptText);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[TTS regenerate] first 200 chars:', normalizedText.slice(0, 200));
  }

  // Call ElevenLabs
  let audioBuffer;
  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/${episode.voice.elevenLabsId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: normalizedText,
        model_id: 'eleven_turbo_v2_5',
        language_code: 'en',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.detail?.message || 'ElevenLabs API error' });
    }

    audioBuffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error('ElevenLabs error:', err.message);
    return res.status(500).json({ error: 'Failed to generate audio' });
  }

  // Upload new audio — use a timestamped path to bust any CDN cache on the old URL
  const storagePath = `${orgId}/${id}_${Date.now()}.mp3`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg' });

  if (uploadError) {
    console.error('Storage upload error:', uploadError.message);
    return res.status(500).json({ error: 'Failed to store audio' });
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);

  const updated = await prisma.episode.update({
    where: { id },
    data: { audioUrl: publicUrl, scriptText, characterCount: normalizedText.length, status: 'draft' },
  });

  res.json({ episodeId: updated.id, audioUrl: updated.audioUrl, status: updated.status });
});

// POST /episodes/:id/paragraphs/:order/regenerate — regenerate one paragraph and stitch
router.post('/:id/paragraphs/:order/regenerate', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id, order: orderStr } = req.params;
  const { text } = req.body;
  const order = parseInt(orderStr, 10);

  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
  if (isNaN(order))  return res.status(400).json({ error: 'order must be a number' });

  const episode = await prisma.episode.findUnique({
    where: { id },
    include: { show: true, voice: true },
  });

  if (!episode || episode.show.organizationId !== orgId) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  if (!episode.voice) {
    return res.status(400).json({ error: 'Episode has no voice — cannot regenerate' });
  }
  if (!episode.audioUrl) {
    return res.status(400).json({ error: 'Episode has no audio' });
  }
  if (!episode.paragraphMeta) {
    return res.status(400).json({ error: 'Episode has no paragraph metadata — regenerate the full episode first' });
  }

  const paragraphs = JSON.parse(episode.paragraphMeta);
  const para = paragraphs.find(p => p.order === order);
  if (!para) return res.status(404).json({ error: `Paragraph ${order} not found` });

  const normalizedText = normalizeForTTS(text);

  // Generate new audio for just this paragraph
  let newAudioBuffer;
  let newDuration = para.timeEnd - para.timeStart; // fallback estimate
  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/${episode.voice.elevenLabsId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: normalizedText,
        model_id: 'eleven_turbo_v2_5',
        language_code: 'en',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.detail?.message || 'ElevenLabs API error' });
    }
    const ttsData = await response.json();
    newAudioBuffer = Buffer.from(ttsData.audio_base64, 'base64');
    if (ttsData.alignment?.character_end_times_seconds?.length) {
      const ends = ttsData.alignment.character_end_times_seconds;
      newDuration = ends[ends.length - 1];
    }
  } catch (err) {
    console.error('ElevenLabs error:', err.message);
    return res.status(500).json({ error: 'Failed to generate audio for paragraph' });
  }

  // Stitch: replace [para.timeStart, para.timeEnd] in the full audio with new audio
  let stitchedBuffer;
  try {
    stitchedBuffer = await spliceSegment(episode.audioUrl, newAudioBuffer, para.timeStart, para.timeEnd);
  } catch (err) {
    console.error('Stitch error:', err.message);
    return res.status(500).json({ error: 'Audio stitching failed — is ffmpeg installed?' });
  }

  // Upload stitched audio
  const storagePath = `${orgId}/${id}_${Date.now()}.mp3`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, stitchedBuffer, { contentType: 'audio/mpeg' });

  if (uploadError) {
    console.error('Storage upload error:', uploadError.message);
    return res.status(500).json({ error: 'Failed to store stitched audio' });
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);

  // Update paragraph metadata: update this para's text + timeEnd, shift subsequent paras
  const oldDuration = para.timeEnd - para.timeStart;
  const shift = newDuration - oldDuration;

  const updatedParagraphs = paragraphs.map(p => {
    if (p.order === order) {
      return { ...p, text, timeEnd: p.timeStart + newDuration };
    }
    if (p.order > order) {
      return { ...p, timeStart: p.timeStart + shift, timeEnd: p.timeEnd + shift };
    }
    return p;
  });

  await prisma.episode.update({
    where: { id },
    data: {
      audioUrl: publicUrl,
      paragraphMeta: JSON.stringify(updatedParagraphs),
      status: 'draft',
    },
  });

  res.json({ episodeId: id, audioUrl: publicUrl, paragraphMeta: updatedParagraphs });
});

module.exports = router;

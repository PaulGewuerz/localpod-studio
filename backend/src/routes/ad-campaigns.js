const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VALID_TYPES = ['pre-roll', 'mid-roll', 'post-roll'];
const VALID_STATUSES = ['active', 'paused'];

// Parse a YYYY-MM-DD date string as end-of-day UTC so campaigns run through the full day.
function parseEndDate(str) {
  if (!str) return null;
  const d = new Date(str);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

// GET /ad-campaigns
router.get('/', async (req, res) => {
  const orgId = req.user.organization.id;
  const campaigns = await prisma.adCampaign.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(campaigns);
});

// POST /ad-campaigns
router.post('/', async (req, res) => {
  const orgId = req.user.organization.id;
  const { name, audioUrl, type, status, startDate, endDate, notes } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });

  const campaign = await prisma.adCampaign.create({
    data: {
      name: name.trim(),
      audioUrl: audioUrl || null,
      type,
      status: VALID_STATUSES.includes(status) ? status : 'active',
      startDate: startDate ? new Date(startDate) : null,
      endDate: parseEndDate(endDate),
      notes: notes || null,
      organizationId: orgId,
    },
  });
  res.json(campaign);
});

// PATCH /ad-campaigns/:id
router.patch('/:id', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;

  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.organizationId !== orgId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const { name, audioUrl, type, status, startDate, endDate, notes } = req.body;
  const data = {};
  if (name !== undefined)      data.name = name.trim();
  if (audioUrl !== undefined)  data.audioUrl = audioUrl || null;
  if (type !== undefined && VALID_TYPES.includes(type)) data.type = type;
  if (status !== undefined && VALID_STATUSES.includes(status)) data.status = status;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined)   data.endDate = endDate ? new Date(endDate) : null;
  if (notes !== undefined)     data.notes = notes || null;

  const updated = await prisma.adCampaign.update({ where: { id }, data });
  res.json(updated);
});

// DELETE /ad-campaigns/:id
router.delete('/:id', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;

  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.organizationId !== orgId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  await prisma.adCampaign.delete({ where: { id } });
  res.json({ deleted: true });
});

// POST /ad-campaigns/generate-audio — generate TTS audio for an ad and return a hosted URL
router.post('/generate-audio', async (req, res) => {
  const orgId = req.user.organization.id;
  const { text, voiceId } = req.body;

  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
  if (!voiceId)      return res.status(400).json({ error: 'voiceId is required' });

  const voice = await prisma.voice.findUnique({ where: { elevenLabsId: voiceId } });
  if (!voice) return res.status(404).json({ error: 'Voice not found' });

  let audioBuffer;
  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.trim(),
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
    console.error('ElevenLabs ad audio error:', err.message);
    return res.status(500).json({ error: 'Failed to generate audio' });
  }

  const storagePath = `ads/${orgId}/${Date.now()}.mp3`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from('audio')
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg' });

  if (uploadError) {
    console.error('Storage upload error:', uploadError.message);
    return res.status(500).json({ error: 'Failed to store audio' });
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath);
  res.json({ audioUrl: publicUrl });
});

// POST /ad-campaigns/upload-audio — accept a raw audio file and return a hosted URL
const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'application/octet-stream'];

router.post('/upload-audio',
  express.raw({ type: AUDIO_MIME_TYPES, limit: '50mb' }),
  async (req, res) => {
    const orgId = req.user.organization.id;

    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'No audio file received' });
    }

    const contentType = req.headers['content-type'] || 'audio/mpeg';
    const ext = contentType.includes('wav') ? 'wav'
              : contentType.includes('ogg') ? 'ogg'
              : contentType.includes('aac') ? 'aac'
              : contentType.includes('mp4') || contentType.includes('m4a') ? 'm4a'
              : 'mp3';

    const storagePath = `ads/${orgId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('audio')
      .upload(storagePath, req.body, { contentType, upsert: false });

    if (uploadError) {
      console.error('Ad audio upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to store audio' });
    }

    const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath);
    res.json({ audioUrl: publicUrl });
  }
);

module.exports = router;

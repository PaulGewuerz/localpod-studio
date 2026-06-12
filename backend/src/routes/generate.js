const express = require('express');
const router = express.Router();
const { randomUUID: uuidv4 } = require('crypto');
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');
const { normalizeForTTS } = require('../utils/normalizeText');
const { splitIntoParagraphs, computeParagraphMeta } = require('../utils/paragraphMeta');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const AUDIO_BUCKET = 'audio';

function applyPronunciationRules(text, rules) {
  let result = text;
  for (const { word, pronunciation } of rules) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, pronunciation);
  }
  return result;
}

router.post('/', async (req, res) => {
  const { articleText, voiceId, title, description, showId } = req.body;
  if (!articleText) return res.status(400).json({ error: 'articleText is required' });
  if (!voiceId)     return res.status(400).json({ error: 'voiceId is required' });

  const org = req.user.organization;

  // Apply pronunciation rules then normalize
  const rules = await prisma.pronunciationRule.findMany({ where: { organizationId: org.id } });
  const processedText = normalizeForTTS(applyPronunciationRules(articleText, rules));

  if (process.env.NODE_ENV !== 'production') {
    console.log('[TTS normalize] first 200 chars:', processedText.slice(0, 200));
  }

  // Enforce monthly character limit
  const CHARACTER_LIMIT = 150_000;
  const now = new Date();
  const periodStart = org.subscription?.currentPeriodStart
    ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const usage = await prisma.episode.aggregate({
    where: { show: { organizationId: org.id }, createdAt: { gte: periodStart }, characterCount: { not: null } },
    _sum: { characterCount: true },
  });
  const usedChars = usage._sum.characterCount ?? 0;
  if (usedChars + processedText.length > CHARACTER_LIMIT) {
    return res.status(402).json({ error: 'character_limit_exceeded' });
  }

  // Call ElevenLabs with-timestamps endpoint
  let audioBuffer;
  let paragraphMeta = null;
  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: processedText,
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
    audioBuffer = Buffer.from(ttsData.audio_base64, 'base64');

    // Compute paragraph timestamps from alignment data
    if (ttsData.alignment) {
      const paragraphs = splitIntoParagraphs(processedText);
      paragraphMeta = computeParagraphMeta(processedText, paragraphs, ttsData.alignment);
    }
  } catch (err) {
    console.error('ElevenLabs error:', err.message);
    return res.status(500).json({ error: 'Failed to generate audio' });
  }

  // Upload to Supabase Storage
  const episodeId = uuidv4();
  const storagePath = `${org.id}/${episodeId}.mp3`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg' });

  if (uploadError) {
    console.error('Storage upload error:', uploadError.message);
    return res.status(500).json({ error: 'Failed to store audio' });
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);

  const voice = await prisma.voice.findUnique({ where: { elevenLabsId: voiceId } });
  const show = showId
    ? await prisma.show.findFirst({ where: { id: showId, organizationId: org.id } })
    : await prisma.show.findFirst({ where: { organizationId: org.id } });
  if (!show) return res.status(400).json({ error: 'No show configured for this organization' });

  const episode = await prisma.episode.create({
    data: {
      id: episodeId,
      title: title || 'Untitled Episode',
      description: description || null,
      scriptText: processedText,
      characterCount: processedText.length,
      paragraphMeta: paragraphMeta ? JSON.stringify(paragraphMeta) : null,
      audioUrl: publicUrl,
      status: 'draft',
      showId: show.id,
      ...(voice ? { voiceId: voice.id } : {}),
    },
  });

  res.json({ episodeId: episode.id, audioUrl: publicUrl });
});

module.exports = router;

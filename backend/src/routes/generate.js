const express = require('express');
const router = express.Router();
const { randomUUID: uuidv4 } = require('crypto');
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');
const { normalizeForTTS } = require('../utils/normalizeText');

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

/** Split normalized text into paragraphs for partial-regeneration support. */
function splitIntoParagraphs(text) {
  const byDouble = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (byDouble.length > 1) return byDouble;
  const bySingle = text.split(/\n/).map(p => p.trim()).filter(Boolean);
  return bySingle.length > 1 ? bySingle : [text.trim()];
}

/**
 * Compute paragraph start/end times from ElevenLabs character alignment data.
 * alignment: { characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[] }
 */
function computeParagraphMeta(fullText, paragraphs, alignment) {
  const { character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  let searchFrom = 0;
  return paragraphs.map((text, order) => {
    const idx = fullText.indexOf(text, searchFrom);
    if (idx === -1) {
      // Fallback — shouldn't happen with clean splits
      return { order, text, timeStart: 0, timeEnd: ends[ends.length - 1] ?? 0 };
    }
    const charStart = Math.min(idx, starts.length - 1);
    const charEnd   = Math.min(idx + text.length - 1, ends.length - 1);
    searchFrom = idx + text.length;
    return {
      order,
      text,
      timeStart: starts[charStart] ?? 0,
      timeEnd:   ends[charEnd]   ?? ends[ends.length - 1] ?? 0,
    };
  });
}

router.post('/', async (req, res) => {
  const { articleText, voiceId, title, description } = req.body;
  if (!articleText) return res.status(400).json({ error: 'articleText is required' });
  if (!voiceId)     return res.status(400).json({ error: 'voiceId is required' });

  const org = req.user.organization;

  // Apply pronunciation rules then normalize
  const rules = await prisma.pronunciationRule.findMany({ where: { organizationId: org.id } });
  const processedText = normalizeForTTS(applyPronunciationRules(articleText, rules));

  if (process.env.NODE_ENV !== 'production') {
    console.log('[TTS normalize] first 200 chars:', processedText.slice(0, 200));
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
  const show  = await prisma.show.findFirst({ where: { organizationId: org.id } });
  if (!show) return res.status(400).json({ error: 'No show configured for this organization' });

  const episode = await prisma.episode.create({
    data: {
      id: episodeId,
      title: title || 'Untitled Episode',
      description: description || null,
      scriptText: processedText,
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

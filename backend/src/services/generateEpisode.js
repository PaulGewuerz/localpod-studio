const { randomUUID: uuidv4 } = require('crypto');
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');
const { normalizeForTTS } = require('../utils/normalizeText');
const { splitIntoParagraphs, computeParagraphMeta } = require('../utils/paragraphMeta');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const AUDIO_BUCKET = 'audio';
const CHARACTER_LIMIT = 150_000;

class GenerationError extends Error {
  constructor(message, code, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function applyPronunciationRules(text, rules) {
  let result = text;
  for (const { word, pronunciation } of rules) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, pronunciation);
  }
  return result;
}

/**
 * Full episode generation pipeline, shared by the manual /generate route and
 * the automatic feed poller: pronunciation rules → normalize → character-limit
 * check → single-pass ElevenLabs /with-timestamps call → Supabase upload →
 * draft Episode with paragraphMeta.
 *
 * @param {object} params
 * @param {object} params.org   - organization with `subscription` included
 * @param {object} params.show  - show belonging to the org
 * @param {string} params.voiceElevenLabsId
 * @param {string} params.articleText
 * @param {string} [params.title]
 * @param {string} [params.description]
 * @returns {Promise<object>} the created Episode
 * @throws {GenerationError} code: character_limit_exceeded | tts_failed | storage_failed
 */
async function generateDraftEpisode({ org, show, voiceElevenLabsId, articleText, title, description }) {
  const rules = await prisma.pronunciationRule.findMany({ where: { organizationId: org.id } });
  const processedText = normalizeForTTS(applyPronunciationRules(articleText, rules));

  if (process.env.NODE_ENV !== 'production') {
    console.log('[TTS normalize] first 200 chars:', processedText.slice(0, 200));
  }

  // Enforce monthly character limit
  const now = new Date();
  const periodStart = org.subscription?.currentPeriodStart
    ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const usage = await prisma.episode.aggregate({
    where: { show: { organizationId: org.id }, createdAt: { gte: periodStart }, characterCount: { not: null } },
    _sum: { characterCount: true },
  });
  const usedChars = usage._sum.characterCount ?? 0;
  if (usedChars + processedText.length > CHARACTER_LIMIT) {
    throw new GenerationError('character_limit_exceeded', 'character_limit_exceeded', 402);
  }

  // Call ElevenLabs with-timestamps endpoint
  const response = await fetch(`${ELEVENLABS_API_URL}/${voiceElevenLabsId}/with-timestamps`, {
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
    throw new GenerationError(err.detail?.message || 'ElevenLabs API error', 'tts_failed', response.status);
  }

  const ttsData = await response.json();
  const audioBuffer = Buffer.from(ttsData.audio_base64, 'base64');

  let paragraphMeta = null;
  if (ttsData.alignment) {
    const paragraphs = splitIntoParagraphs(processedText);
    paragraphMeta = computeParagraphMeta(processedText, paragraphs, ttsData.alignment);
  }

  // Upload to Supabase Storage
  const episodeId = uuidv4();
  const storagePath = `${org.id}/${episodeId}.mp3`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg' });

  if (uploadError) {
    console.error('Storage upload error:', uploadError.message);
    throw new GenerationError('Failed to store audio', 'storage_failed', 500);
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);

  const voice = await prisma.voice.findUnique({ where: { elevenLabsId: voiceElevenLabsId } });

  return prisma.episode.create({
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
}

module.exports = { generateDraftEpisode, GenerationError };

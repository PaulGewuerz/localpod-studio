const { randomUUID: uuidv4 } = require('crypto');
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');
const { normalizeForTTS } = require('../utils/normalizeText');
const { cleanArticleText } = require('../utils/cleanArticleText');
const { splitIntoParagraphs, computeParagraphMeta } = require('../utils/paragraphMeta');
const { concatAudioBuffers } = require('../utils/stitchAudio');
const { characterLimitForPlan } = require('../utils/planLimits');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const AUDIO_BUCKET = 'audio';
// eleven_multilingual_v2 rejects requests over 10,000 characters; keep headroom.
const MAX_TTS_CHARS = 9500;

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

function splitPreserving(text, regex) {
  return text.split(regex).filter(s => s.length > 0);
}

/**
 * Split text into TTS-sized chunks at paragraph boundaries (falling back to
 * sentence boundaries, then a hard slice). Every character of the input is
 * preserved so the chunks concatenate back to the exact original text — this
 * keeps merged alignment indexes matching the full script for paragraphMeta.
 */
function chunkForTTS(text, maxLen = MAX_TTS_CHARS) {
  if (text.length <= maxLen) return [text];

  let pieces = splitPreserving(text, /(\n+)/);
  pieces = pieces.flatMap(p => p.length <= maxLen ? [p] : splitPreserving(p, /((?<=[.!?])\s+)/));
  pieces = pieces.flatMap(p => {
    if (p.length <= maxLen) return [p];
    const hard = [];
    for (let i = 0; i < p.length; i += maxLen) hard.push(p.slice(i, i + maxLen));
    return hard;
  });

  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > maxLen) {
      chunks.push(current);
      current = piece;
    } else {
      current += piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function ttsRequest(voiceElevenLabsId, body) {
  const response = await fetch(`${ELEVENLABS_API_URL}/${voiceElevenLabsId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new GenerationError(err.detail?.message || 'ElevenLabs API error', 'tts_failed', response.status);
  }
  return response.json();
}

/**
 * Text-to-speech for scripts of any length. Scripts over the per-request cap
 * are split into paragraph-boundary chunks, generated sequentially with
 * previous_text/next_text conditioning for prosody continuity, and stitched
 * back together; chunk alignments are merged (time-offset by cumulative audio
 * duration) so the result behaves like one /with-timestamps call.
 *
 * @returns {Promise<{ audioBuffer: Buffer, alignment: object|null }>}
 * @throws {GenerationError} code: tts_failed
 */
async function synthesizeSpeech(voiceElevenLabsId, text, maxLen = MAX_TTS_CHARS) {
  const chunks = chunkForTTS(text, maxLen);
  const buffers = [];
  const characters = [];
  const starts = [];
  const ends = [];
  let offset = 0;
  let alignmentOk = true;

  for (let i = 0; i < chunks.length; i++) {
    const ttsData = await ttsRequest(voiceElevenLabsId, {
      text: chunks[i],
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      // Conditioning context only (not spoken, not billed) — keeps the voice's
      // prosody flowing across chunk boundaries.
      previous_text: i > 0 ? chunks[i - 1].slice(-300) : undefined,
      next_text: i < chunks.length - 1 ? chunks[i + 1].slice(0, 300) : undefined,
    });
    buffers.push(Buffer.from(ttsData.audio_base64, 'base64'));

    const a = ttsData.alignment;
    if (a?.character_end_times_seconds?.length) {
      characters.push(...(a.characters || []));
      starts.push(...a.character_start_times_seconds.map(t => t + offset));
      ends.push(...a.character_end_times_seconds.map(t => t + offset));
      // Chunk audio duration ≈ last character end time (trailing silence is
      // negligible in ElevenLabs output; same assumption as paragraph regen).
      offset += a.character_end_times_seconds[a.character_end_times_seconds.length - 1];
    } else {
      alignmentOk = false;
    }
  }

  const audioBuffer = await concatAudioBuffers(buffers);
  return {
    audioBuffer,
    alignment: alignmentOk
      ? { characters, character_start_times_seconds: starts, character_end_times_seconds: ends }
      : null,
  };
}

/**
 * Full episode generation pipeline, shared by the manual /generate route and
 * the automatic feed poller: pronunciation rules → normalize → character-limit
 * check → ElevenLabs /with-timestamps (chunked when over the per-request cap)
 * → Supabase upload → draft Episode with paragraphMeta.
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
  const characterLimit = characterLimitForPlan(org.subscription?.plan);
  if (usedChars + processedText.length > characterLimit) {
    throw new GenerationError('character_limit_exceeded', 'character_limit_exceeded', 402);
  }

  // Long scripts are chunked across multiple TTS calls and stitched — no upper
  // length limit here beyond the monthly character cap enforced above.
  const { audioBuffer, alignment } = await synthesizeSpeech(voiceElevenLabsId, processedText);

  let paragraphMeta = null;
  if (alignment) {
    const paragraphs = splitIntoParagraphs(processedText);
    paragraphMeta = computeParagraphMeta(processedText, paragraphs, alignment);
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

/**
 * Distribute mid-roll campaigns across the available article-boundary times.
 * Boundaries are the spoken gaps between articles in a digest. With M campaigns
 * and B boundaries, picks evenly-spread boundaries; if there are no boundaries
 * (single-article digest), falls back to splitting the duration into M+1 parts.
 *
 * @returns {number[]} insertAt seconds, one per mid-roll campaign, ascending
 */
function placeMidRolls(midRollCount, boundaryTimes, durationSec) {
  if (midRollCount <= 0) return [];
  const positions = [];

  if (boundaryTimes.length > 0) {
    const B = boundaryTimes.length;
    const used = new Set();
    for (let k = 1; k <= midRollCount; k++) {
      let idx = Math.round((k * B) / (midRollCount + 1)) - 1; // 0-based into boundaryTimes
      idx = Math.max(0, Math.min(B - 1, idx));
      while (used.has(idx) && idx < B - 1) idx++;
      while (used.has(idx) && idx > 0) idx--;
      used.add(idx);
      positions.push(boundaryTimes[idx]);
    }
  } else if (durationSec > 0) {
    for (let k = 1; k <= midRollCount; k++) {
      positions.push(Math.round((durationSec * k) / (midRollCount + 1) * 10) / 10);
    }
  }

  return [...new Set(positions)].sort((a, b) => a - b);
}

/**
 * Build per-episode ad assignments + markers from a show's automation ad selections.
 * Only campaigns that still exist, belong to the org, and are active are included.
 * Mid-roll positions are auto-placed at article boundaries (movable in review).
 *
 * @returns {Promise<{ adAssignments: object[], adMarkers: object } | null>}
 */
async function buildAutomationAds({ orgId, selections, boundaryTimes, durationSec }) {
  if (!selections) return null;
  const { preRollCampaignId, postRollCampaignId, midRollCampaignIds } = selections;
  const midIds = Array.isArray(midRollCampaignIds) ? midRollCampaignIds.filter(Boolean) : [];

  const wantedIds = [...new Set([preRollCampaignId, postRollCampaignId, ...midIds].filter(Boolean))];
  if (!wantedIds.length) return null;

  const campaigns = await prisma.adCampaign.findMany({
    where: { id: { in: wantedIds }, organizationId: orgId, status: 'active' },
    select: { id: true },
  });
  const valid = new Set(campaigns.map(c => c.id));

  const assignments = [];
  if (preRollCampaignId && valid.has(preRollCampaignId)) {
    assignments.push({ campaignId: preRollCampaignId, type: 'pre-roll' });
  }

  const validMidIds = midIds.filter(id => valid.has(id));
  const midPositions = placeMidRolls(validMidIds.length, boundaryTimes, durationSec);
  validMidIds.forEach((id, i) => {
    if (midPositions[i] != null) {
      assignments.push({ campaignId: id, type: 'mid-roll', insertAt: midPositions[i] });
    }
  });

  if (postRollCampaignId && valid.has(postRollCampaignId)) {
    assignments.push({ campaignId: postRollCampaignId, type: 'post-roll' });
  }

  if (!assignments.length) return null;

  return {
    adAssignments: assignments,
    adMarkers: {
      preRoll: assignments.some(a => a.type === 'pre-roll'),
      postRoll: assignments.some(a => a.type === 'post-roll'),
      midRoll: assignments.filter(a => a.type === 'mid-roll').map(a => a.insertAt),
    },
  };
}

/**
 * Digest generation for the automatic episode flow: combines several feed
 * articles into one draft episode. Each article is cleaned + normalized
 * independently so character offsets (and thus article-boundary timestamps for
 * mid-roll placement) stay accurate, then joined into a single script and sent
 * in one ElevenLabs /with-timestamps call. Ad campaigns selected at the show
 * level are auto-assigned (mid-rolls placed at article boundaries).
 *
 * @param {object} params
 * @param {object} params.org      - organization with `subscription` included
 * @param {object} params.show     - show with `automationAdSelections`
 * @param {string} params.voiceElevenLabsId
 * @param {Array<{ title?: string, text: string }>} params.segments - one per article, newest first
 * @param {string} params.title
 * @param {string} [params.description]
 * @returns {Promise<object>} the created Episode
 * @throws {GenerationError}
 */
async function generateDigestEpisode({ org, show, voiceElevenLabsId, segments, title, description }) {
  const rules = await prisma.pronunciationRule.findMany({ where: { organizationId: org.id } });

  // Normalize each article independently so we can track exact boundaries.
  const processedSegments = segments
    .map(s => normalizeForTTS(applyPronunciationRules(cleanArticleText(s.text), rules)))
    .filter(Boolean);

  if (!processedSegments.length) {
    throw new GenerationError('no usable article text', 'empty_digest', 422);
  }

  const SEPARATOR = '\n\n';

  // eleven_multilingual_v2 caps a request at 10k characters. Segments arrive
  // newest first, so drop the oldest articles until the digest fits.
  let dropped = 0;
  while (processedSegments.length > 1 && processedSegments.join(SEPARATOR).length > MAX_TTS_CHARS) {
    processedSegments.pop();
    dropped++;
  }
  if (dropped > 0) {
    console.warn(`[digest] dropped ${dropped} oldest article(s) to fit ${MAX_TTS_CHARS}-char TTS limit (show ${show.id})`);
  }
  if (processedSegments.join(SEPARATOR).length > MAX_TTS_CHARS) {
    throw new GenerationError(`Script is too long (max ${MAX_TTS_CHARS} characters)`, 'script_too_long', 422);
  }

  const processedText = processedSegments.join(SEPARATOR);

  // Character offset where each segment begins in the combined script.
  const boundaryOffsets = [];
  let offset = 0;
  processedSegments.forEach((seg, i) => {
    if (i > 0) boundaryOffsets.push(offset);
    offset += seg.length + SEPARATOR.length;
  });

  // Enforce monthly character limit
  const now = new Date();
  const periodStart = org.subscription?.currentPeriodStart
    ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const usage = await prisma.episode.aggregate({
    where: { show: { organizationId: org.id }, createdAt: { gte: periodStart }, characterCount: { not: null } },
    _sum: { characterCount: true },
  });
  const usedChars = usage._sum.characterCount ?? 0;
  const characterLimit = characterLimitForPlan(org.subscription?.plan);
  if (usedChars + processedText.length > characterLimit) {
    throw new GenerationError('character_limit_exceeded', 'character_limit_exceeded', 402);
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/${voiceElevenLabsId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: processedText,
      model_id: 'eleven_multilingual_v2',
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
  let boundaryTimes = [];
  let durationSec = 0;
  if (ttsData.alignment) {
    const paragraphs = splitIntoParagraphs(processedText);
    paragraphMeta = computeParagraphMeta(processedText, paragraphs, ttsData.alignment);

    const starts = ttsData.alignment.character_start_times_seconds || [];
    const ends = ttsData.alignment.character_end_times_seconds || [];
    durationSec = ends[ends.length - 1] ?? 0;
    boundaryTimes = boundaryOffsets
      .map(o => starts[Math.min(o, starts.length - 1)])
      .filter(t => typeof t === 'number');
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

  const ads = await buildAutomationAds({
    orgId: org.id,
    selections: show.automationAdSelections,
    boundaryTimes,
    durationSec,
  });

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
      ...(ads ? { adAssignments: JSON.stringify(ads.adAssignments), adMarkers: JSON.stringify(ads.adMarkers) } : {}),
    },
  });
}

module.exports = { generateDraftEpisode, generateDigestEpisode, synthesizeSpeech, GenerationError, MAX_TTS_CHARS };

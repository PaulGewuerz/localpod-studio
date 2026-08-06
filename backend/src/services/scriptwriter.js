/**
 * LLM scriptwriter for the automatic episode flow. Turns the day's raw articles
 * into a single conversational spoken script plus HTML show notes, so automated
 * shows produce a real narrated episode instead of concatenated article text.
 *
 * Called by the feed poller (Phase 2) between article extraction and TTS. The
 * returned `scriptText` is fed to the existing single-pass ElevenLabs path; the
 * `showNotesHtml` lands in `Episode.description` (what publishes to Megaphone).
 *
 * Provider is isolated here: Claude via the official Anthropic SDK, env-keyed
 * (`ANTHROPIC_API_KEY`). Model is overridable with `SCRIPTWRITER_MODEL`.
 */

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_WORD_TARGET = 700;
const MAX_INPUT_CHARS = 24000;   // cap total article text fed to the LLM (cost + latency guard)
const MAX_OUTPUT_TOKENS = 4000;  // ~700-word script + HTML notes fits comfortably

class ScriptwriterError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Structured-output contract — forces the model to return exactly these fields.
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    scriptText: { type: 'string' },      // plain spoken text (no markdown/HTML) — goes to TTS
    showNotesHtml: { type: 'string' },   // rich HTML with source <a href> links — goes to Episode.description
    description: { type: 'string' },      // short plain-text summary (≤ 500 chars)
  },
  required: ['title', 'scriptText', 'showNotesHtml', 'description'],
  additionalProperties: false,
};

let _client = null;
function getClient() {
  if (_client) return _client;
  const Anthropic = require('@anthropic-ai/sdk');
  // Reads ANTHROPIC_API_KEY from the environment. 10-minute default timeout,
  // auto-retries 429/5xx twice.
  _client = new Anthropic();
  return _client;
}

function buildSystemPrompt(scriptConfig = {}) {
  const wordTarget = Number(scriptConfig.wordTarget) || DEFAULT_WORD_TARGET;
  const tone = scriptConfig.tone || 'warm, natural, and conversational — like a trusted local host';

  return [
    'You are the scriptwriter for a local-news audio show. You turn the day\'s articles into a single spoken-word script that one AI host reads start to finish, plus HTML show notes.',
    '',
    'Write the SCRIPT as flowing spoken language for text-to-speech:',
    `- Tone: ${tone}.`,
    `- Target about ${wordTarget} words (a little over or under is fine).`,
    '- Structure it as a natural broadcast: a brief cold open that names the date, the lead story, then the other items as short segments, and a friendly sign-off.',
    '- Only include a section if the source articles actually support it — never invent weather, events, or facts that are not in the provided text.',
    '- Skip advertisements, sponsorships, affiliate content, subscription pitches, and "read more" boilerplate entirely.',
    '- Plain spoken text only: no markdown, no headings, no URLs, no bullet points, no stage directions.',
    '',
    'Write the SHOW NOTES as clean HTML (paragraphs and links) summarizing the episode, linking each story to its source URL where one is provided.',
    '',
    'Write the DESCRIPTION as one short plain-text sentence (≤ 500 characters) summarizing the episode.',
    scriptConfig.extraGuidance ? `\nAdditional guidance for this show:\n${scriptConfig.extraGuidance}` : '',
  ].join('\n');
}

function buildUserPrompt({ segments, showName, date }) {
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const articles = segments.map((s, i) => {
    const header = `Article ${i + 1}: ${s.title || 'Untitled'}`;
    const src = s.url ? `Source URL: ${s.url}` : 'Source URL: (none)';
    return `${header}\n${src}\n${s.text}`;
  }).join('\n\n---\n\n');

  return [
    `Show: ${showName || 'Daily Digest'}`,
    `Episode date: ${dateStr}`,
    '',
    `Write today's episode from the following ${segments.length} article(s):`,
    '',
    articles,
  ].join('\n');
}

/**
 * @param {object} params
 * @param {Array<{ title?: string, text: string, url?: string }>} params.segments  one per article, newest first
 * @param {object} [params.scriptConfig]  Show.scriptConfig: { tone, wordTarget, extraGuidance }
 * @param {string} [params.showName]
 * @param {Date}   [params.date]
 * @param {object} [params.client]  inject an Anthropic-compatible client (for tests)
 * @returns {Promise<{ title: string, scriptText: string, showNotesHtml: string, description: string }>}
 * @throws {ScriptwriterError}
 */
async function writeEpisodeScript({ segments, scriptConfig = {}, showName, date = new Date(), client = null }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new ScriptwriterError('no article segments to write from', 'empty_input');
  }

  // Trim total input to the char budget, dropping oldest articles first (segments
  // arrive newest-first, matching the digest path).
  const trimmed = [];
  let used = 0;
  for (const seg of segments) {
    const text = String(seg.text || '');
    if (!text.trim()) continue;
    if (trimmed.length > 0 && used + text.length > MAX_INPUT_CHARS) break;
    trimmed.push({ ...seg, text: text.slice(0, MAX_INPUT_CHARS) });
    used += text.length;
  }
  if (!trimmed.length) {
    throw new ScriptwriterError('article segments had no usable text', 'empty_input');
  }

  const anthropic = client || getClient();

  let response;
  try {
    response = await anthropic.messages.create({
      model: process.env.SCRIPTWRITER_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      system: buildSystemPrompt(scriptConfig),
      messages: [{ role: 'user', content: buildUserPrompt({ segments: trimmed, showName, date }) }],
    });
  } catch (err) {
    throw new ScriptwriterError(`LLM request failed: ${err.message}`, 'llm_failed');
  }

  if (response.stop_reason === 'refusal') {
    throw new ScriptwriterError('LLM refused to write this script', 'refusal');
  }

  const textBlock = (response.content || []).find(b => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new ScriptwriterError('LLM returned no script text', 'no_output');
  }

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new ScriptwriterError('LLM output was not valid JSON', 'bad_output');
  }

  const scriptText = String(parsed.scriptText || '').trim();
  if (!scriptText) {
    throw new ScriptwriterError('LLM produced an empty script', 'bad_output');
  }

  return {
    title: String(parsed.title || '').trim() || (showName || 'Daily Digest'),
    scriptText,
    showNotesHtml: String(parsed.showNotesHtml || '').trim(),
    description: String(parsed.description || '').trim().slice(0, 500),
  };
}

module.exports = { writeEpisodeScript, ScriptwriterError, OUTPUT_SCHEMA };

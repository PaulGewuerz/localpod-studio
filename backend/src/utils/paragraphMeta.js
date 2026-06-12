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

module.exports = { splitIntoParagraphs, computeParagraphMeta };

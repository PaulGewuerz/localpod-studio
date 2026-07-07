// One-off: verify chunked TTS (synthesizeSpeech) end to end with a small
// forced maxLen so a ~300-char script exercises the multi-chunk path:
// multiple /with-timestamps calls + previous/next_text conditioning +
// alignment merge + ffmpeg concat. Spends ~300 ElevenLabs credits.
require('dotenv').config();

const fs = require('fs');
const { synthesizeSpeech } = require('../src/services/generateEpisode');
const { splitIntoParagraphs, computeParagraphMeta } = require('../src/utils/paragraphMeta');

const VOICE_ID = 'HKFOb9iktHA85uKXydRT'; // Russ (professional, fine-tuned)

const TEXT = [
  'Good morning, and welcome to the LocalPod Studio chunk test.',
  'This second paragraph should land in a different TTS request than the first one.',
  'Finally, a third paragraph confirms timing offsets keep accumulating across chunks.',
].join('\n\n');

(async () => {
  const { audioBuffer, alignment } = await synthesizeSpeech(VOICE_ID, TEXT, 100);

  console.log(`audio bytes: ${audioBuffer.length}`);
  console.log(`alignment present: ${!!alignment}`);
  if (!alignment) process.exit(1);

  const chars = alignment.characters.join('');
  console.log(`alignment chars match input text: ${chars === TEXT}`);

  const starts = alignment.character_start_times_seconds;
  const monotonic = starts.every((t, i) => i === 0 || t >= starts[i - 1]);
  console.log(`start times monotonic: ${monotonic}`);

  const meta = computeParagraphMeta(TEXT, splitIntoParagraphs(TEXT), alignment);
  for (const p of meta) {
    console.log(`para ${p.order}: ${p.timeStart.toFixed(2)}s → ${p.timeEnd.toFixed(2)}s  "${p.text.slice(0, 40)}…"`);
  }

  fs.writeFileSync('test-output-chunked.mp3', audioBuffer);
  console.log('wrote test-output-chunked.mp3 — listen for smooth transitions between paragraphs');
})();

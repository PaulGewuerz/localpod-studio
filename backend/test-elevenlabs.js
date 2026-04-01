require('dotenv').config();
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = 'BHf91PCMVcVwq6r1ku7L'; // Ava
const URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

const CASES = [
  {
    name: '01_normal',
    text: 'Good morning. Today\'s top story: the city council voted unanimously to approve the new transit expansion.',
  },
  {
    name: '02_long_script',
    text: 'Lorem ipsum dolor sit amet. '.repeat(150).trim(), // ~4,200 chars
  },
  {
    name: '03_special_chars',
    text: 'The cost rose 12% — up from $4.50 to $5.04 — a "significant" jump, said CEO O\'Brien. See figure #3 & table A/B.',
  },
  {
    name: '04_numbers_dates',
    text: 'On March 19th, 2026, at 9:45 AM, the Fed raised rates by 0.25 basis points to 5.375%.',
  },
  {
    name: '05_abbreviations',
    text: 'The U.S. EPA issued a notice to the N.Y. Dept. of Transportation re: CO2 limits on I-95.',
  },
  {
    name: '06_empty',
    text: '',
  },
  {
    name: '07_very_long',
    text: 'The quick brown fox jumped over the lazy dog. '.repeat(300).trim(), // ~13,500 chars — over API limit
  },
];

async function testCase({ name, text }) {
  if (!text) {
    console.log(`[${name}] SKIPPED — empty text (validated client-side)`);
    return;
  }

  const charCount = text.length;
  process.stdout.write(`[${name}] ${charCount} chars — `);

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.log(`FAIL ${res.status} — ${JSON.stringify(err.detail || err)}`);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const outPath = path.join(__dirname, `test-output-${name}.mp3`);
    fs.writeFileSync(outPath, buffer);
    console.log(`OK — ${buffer.length} bytes saved to test-output-${name}.mp3`);
  } catch (err) {
    console.log(`ERROR — ${err.message}`);
  }
}

(async () => {
  console.log('ElevenLabs API Test\n' + '='.repeat(50));
  for (const c of CASES) {
    await testCase(c);
  }
  console.log('\nDone. Play the .mp3 files to verify audio quality.');
})();

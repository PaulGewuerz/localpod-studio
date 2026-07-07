// One-off: verify eleven_multilingual_v2 works on the /with-timestamps
// endpoint with our exact production request shape (no language_code).
require('dotenv').config();

const VOICE_ID = 'HKFOb9iktHA85uKXydRT'; // Russ (professional, fine-tuned)

(async () => {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: 'Good morning. This is a short test of the multilingual voice model for LocalPod Studio.',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.log(`FAIL ${res.status} — ${JSON.stringify(err.detail || err)}`);
    process.exit(1);
  }

  const data = await res.json();
  const audioBytes = Buffer.from(data.audio_base64, 'base64').length;
  const ends = data.alignment?.character_end_times_seconds || [];
  console.log(`OK — ${audioBytes} audio bytes, alignment present: ${!!data.alignment}, duration ${ends[ends.length - 1] ?? '?'}s`);
})();

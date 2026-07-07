// One-off: verify every voice in the DB (plus seed roster) supports eleven_multilingual_v2.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SEED_VOICES = [
  { name: 'Ava',      id: 'BHf91PCMVcVwq6r1ku7L' },
  { name: 'Brian',    id: 'nPczCjzI2devNBz1zQrb' },
  { name: 'Matilda',  id: 'XrExE9yKIg1WjnnlVkGX' },
  { name: 'Karen',    id: 'GkP5h0UAcZQ2i4aDPipF' },
  { name: 'William',  id: 'l7PKZGTaZgsdjGbTQRfS' },
  { name: 'Russ',     id: 'HKFOb9iktHA85uKXydRT' },
  { name: 'Kary',     id: '4rwC6xlwNjrg40xWm8Vb' },
  { name: 'Jonathon', id: 'oyxaSt75JW8l04MCJaSo' },
  { name: 'Ivanna',   id: '0S5oIfi8zOZixuSj8K6n' },
];

async function main() {
  const dbVoices = await prisma.voice.findMany({
    select: { name: true, elevenLabsId: true },
  });
  const all = new Map();
  for (const v of dbVoices) all.set(v.elevenLabsId, { name: v.name, source: 'db' });
  for (const v of SEED_VOICES) {
    if (all.has(v.id)) all.get(v.id).source += '+seed';
    else all.set(v.id, { name: v.name, source: 'seed' });
  }

  for (const [id, meta] of all) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      });
      if (!res.ok) {
        console.log(`${meta.name} (${id}) [${meta.source}]: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const hq = data.high_quality_base_model_ids || [];
      const ftState = data.fine_tuning && data.fine_tuning.state
        ? data.fine_tuning.state.eleven_multilingual_v2 || 'n/a'
        : 'n/a';
      console.log(
        `${meta.name} (${id}) [${meta.source}] category=${data.category} ` +
        `multilingual_v2_hq=${hq.includes('eleven_multilingual_v2')} ` +
        `ft_state=${ftState} hq_models=[${hq.join(', ')}]`
      );
    } catch (e) {
      console.log(`${meta.name} (${id}): ERROR ${e.message}`);
    }
  }
  await prisma.$disconnect();
}

main();

// One-off repair, part 2 (2026-07-09): attach the recovered 6-min "Good Roads"
// audio (re-downloaded from ElevenLabs history — the app's copy was wiped when
// episode 6ecab492 was deleted) to the live draft, and sync the script text
// from that deleted episode so the review page matches the audio.
// Usage: node scripts/attach-recovered-audio.js "<path-to-downloaded-mp3>"
require('dotenv').config();
const fs = require('fs');
const prisma = require('../src/prisma');
const { supabaseAdmin } = require('../src/supabase');

const EPISODE_ID = '60e65a32-d27a-4ae3-8439-df03c039ead4';
const DELETED_SOURCE_ID = '6ecab492-6832-4a3a-9d6d-7ed370dd4569';
const ORG_ID = '2409eec4-61fe-4616-9513-acb07d1165e1';

async function main() {
  const filePath = process.argv[2];
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Pass the path to the downloaded MP3');

  const audioBuffer = fs.readFileSync(filePath);
  console.log('Read', Math.round(audioBuffer.length / 1024), 'KB from', filePath);

  const source = await prisma.episode.findUnique({ where: { id: DELETED_SOURCE_ID } });
  if (!source?.scriptText) throw new Error('Deleted source episode script not found');

  const storagePath = `${ORG_ID}/${EPISODE_ID}_${Date.now()}.mp3`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from('audio')
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg' });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath);

  const updated = await prisma.episode.update({
    where: { id: EPISODE_ID },
    data: {
      audioUrl: publicUrl,
      scriptText: source.scriptText,
      paragraphMeta: null,
      status: 'draft',
      megaphoneEpisodeId: null,
      publishedUrl: null,
      scheduledAt: null,
    },
  });

  console.log('Attached:', { id: updated.id, status: updated.status, audioUrl: updated.audioUrl });
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

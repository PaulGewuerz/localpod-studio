// One-off repair (2026-07-09): "The Good Roads Our Counties Need" went live on
// Megaphone with the wrong (3-min) audio. The wanted 6-min audio belonged to an
// earlier, since-deleted episode (60afe343…); its last surviving storage file is
// swapped onto the live episode here. Removes the wrong episode from Megaphone
// and resets the episode to draft so it can be re-approved in the studio.
// paragraphMeta is cleared because its timings describe the old 3-min audio.
require('dotenv').config();
const prisma = require('../src/prisma');
const { getHostingAdapter } = require('../src/adapters/hosting');

const EPISODE_ID = '60e65a32-d27a-4ae3-8439-df03c039ead4';
const DELETED_SOURCE_ID = '60afe343-84cf-4139-8999-37d1457bf5e5';
const AUDIO_URL = 'https://fkxhchvqozsgybjlibin.supabase.co/storage/v1/object/public/audio/2409eec4-61fe-4616-9513-acb07d1165e1/60afe343-84cf-4139-8999-37d1457bf5e5_1783534908423.mp3';

async function main() {
  const episode = await prisma.episode.findUnique({
    where: { id: EPISODE_ID },
    include: { show: true },
  });
  if (!episode) throw new Error('Episode not found');

  const source = await prisma.episode.findUnique({ where: { id: DELETED_SOURCE_ID } });

  if (episode.megaphoneEpisodeId && episode.show.megaphoneShowId) {
    const adapter = getHostingAdapter();
    await adapter.deleteEpisode(episode.show.megaphoneShowId, episode.megaphoneEpisodeId);
    console.log('Deleted wrong-audio episode from Megaphone:', episode.megaphoneEpisodeId);
  } else {
    console.log('No Megaphone episode linked — nothing to delete there.');
  }

  const updated = await prisma.episode.update({
    where: { id: EPISODE_ID },
    data: {
      audioUrl: AUDIO_URL,
      scriptText: source?.scriptText ?? episode.scriptText,
      paragraphMeta: null,
      status: 'draft',
      megaphoneEpisodeId: null,
      publishedUrl: null,
      scheduledAt: null,
    },
  });

  console.log('Episode reset:', {
    id: updated.id,
    status: updated.status,
    audioUrl: updated.audioUrl,
    scriptSynced: !!source?.scriptText,
  });
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

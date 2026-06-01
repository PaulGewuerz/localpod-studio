const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { getHostingAdapter } = require('../adapters/hosting');
const { preparePublishAudio } = require('../utils/preparePublishAudio');

router.post('/', async (req, res) => {
  const { episodeId, title, description, pubdate } = req.body;
  if (!episodeId) return res.status(400).json({ error: 'episodeId is required' });

  const orgId = req.user.organization.id;

  // Load episode and verify it belongs to this org
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: { show: true },
  });

  if (!episode || episode.show.organizationId !== orgId) {
    return res.status(404).json({ error: 'Episode not found' });
  }

  if (!episode.audioUrl) {
    return res.status(400).json({ error: 'Episode has no audio — generate audio first' });
  }

  const megaphoneShowId = episode.show.megaphoneShowId;
  if (!megaphoneShowId) {
    return res.status(400).json({ error: 'Show has no Megaphone show configured' });
  }

  try {
    const adapter = getHostingAdapter();
    // Don't send Megaphone DAI slots when local stitching is in use — the ad is
    // already baked into the audio. Sending postCount/preCount on a podcast that
    // doesn't have DAI enabled causes Megaphone to get stuck in "processing".
    const hasLocalStitching = !!episode.adAssignments;
    const adMarkers = (!hasLocalStitching && episode.adMarkers) ? JSON.parse(episode.adMarkers) : null;
    const audioUrl = await preparePublishAudio(episode, orgId, prisma);
    const { id: megaphoneEpisodeId, url: publishedUrl } = await adapter.publishEpisode(
      megaphoneShowId,
      {
        title: title || episode.title,
        description: description || episode.description || '',
        audioUrl,
        pubdate: pubdate || new Date().toISOString(),
        adMarkers,
      }
    );

    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'published', publishedUrl, megaphoneEpisodeId },
    });

    res.json({ episodeId, megaphoneEpisodeId, publishedUrl });
  } catch (err) {
    console.error('Publish error:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to publish episode' });
  }
});

module.exports = router;

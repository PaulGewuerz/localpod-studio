const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { getHostingAdapter } = require('../adapters/hosting');

router.post('/', async (req, res) => {
  const { episodeId, title, description, pubdate } = req.body;
  if (!episodeId) return res.status(400).json({ error: 'episodeId is required' });
  if (!pubdate) return res.status(400).json({ error: 'pubdate is required' });

  const scheduledAt = new Date(pubdate);
  if (isNaN(scheduledAt.getTime())) {
    return res.status(400).json({ error: 'pubdate must be a valid ISO 8601 date' });
  }
  if (scheduledAt <= new Date()) {
    return res.status(400).json({ error: 'pubdate must be in the future' });
  }

  const orgId = req.user.organization.id;

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

  const megaphoneShowId = req.user.organization.megaphoneShowId;
  if (!megaphoneShowId) {
    return res.status(400).json({ error: 'Organization has no Megaphone show configured' });
  }

  try {
    const adapter = getHostingAdapter();
    const { id: megaphoneEpisodeId, url: publishedUrl } = await adapter.publishEpisode(
      megaphoneShowId,
      {
        title: title || episode.title,
        description: description || episode.description || '',
        audioUrl: episode.audioUrl,
        pubdate: scheduledAt.toISOString(),
      }
    );

    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'scheduled', publishedUrl, megaphoneEpisodeId, scheduledAt },
    });

    res.json({ episodeId, megaphoneEpisodeId, publishedUrl, scheduledFor: scheduledAt.toISOString() });
  } catch (err) {
    console.error('Schedule error:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to schedule episode' });
  }
});

module.exports = router;

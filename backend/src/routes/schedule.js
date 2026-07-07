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
  if (episode.status === 'published') {
    return res.status(400).json({ error: 'Episode is already published' });
  }

  const megaphoneShowId = episode.show.megaphoneShowId;
  if (!megaphoneShowId) {
    return res.status(400).json({ error: 'Show has no Megaphone show configured' });
  }

  try {
    const adapter = getHostingAdapter();

    // Retry safety: if this episode already exists on Megaphone (e.g. the client
    // gave up on a slow request and retried), update its pubdate instead of
    // creating a duplicate Megaphone episode.
    if (episode.megaphoneEpisodeId) {
      await adapter.updateEpisode(megaphoneShowId, episode.megaphoneEpisodeId, {
        title: title || episode.title,
        pubdate: scheduledAt.toISOString(),
      });
      await prisma.episode.update({
        where: { id: episodeId },
        data: { status: 'scheduled', scheduledAt },
      });
      return res.json({
        episodeId,
        megaphoneEpisodeId: episode.megaphoneEpisodeId,
        publishedUrl: episode.publishedUrl,
        scheduledFor: scheduledAt.toISOString(),
      });
    }

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

router.patch('/', async (req, res) => {
  const { episodeId, pubdate } = req.body;
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

  if (!episode.megaphoneEpisodeId) {
    return res.status(400).json({ error: 'Episode has not been scheduled yet' });
  }

  const megaphoneShowId = episode.show.megaphoneShowId;

  try {
    const adapter = getHostingAdapter();
    await adapter.updateEpisode(megaphoneShowId, episode.megaphoneEpisodeId, {
      pubdate: scheduledAt.toISOString(),
    });

    await prisma.episode.update({
      where: { id: episodeId },
      data: { scheduledAt },
    });

    res.json({ episodeId, scheduledFor: scheduledAt.toISOString() });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to reschedule episode' });
  }
});

module.exports = router;

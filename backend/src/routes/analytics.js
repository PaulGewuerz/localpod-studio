const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { getHostingAdapter } = require('../adapters/hosting');

// GET /analytics — fetch Megaphone episode download data for a show
router.get('/', async (req, res) => {
  const orgId = req.user.organization.id;
  const { showId } = req.query;

  const show = showId
    ? await prisma.show.findFirst({ where: { id: showId, organizationId: orgId } })
    : await prisma.show.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } });

  if (!show?.megaphoneShowId) {
    return res.json({ available: false, reason: 'No Megaphone show connected yet.' });
  }

  try {
    const adapter = getHostingAdapter();

    // Fetch episodes (includes per-episode download counts)
    const episodes = await adapter.getEpisodes(show.megaphoneShowId);

    // Build a map from megaphoneEpisodeId → our internal episode ID
    const dbEpisodes = await prisma.episode.findMany({
      where: { show: { organizationId: req.user.organization.id }, megaphoneEpisodeId: { not: null } },
      select: { id: true, megaphoneEpisodeId: true },
    });
    const internalIdByMegaphone = Object.fromEntries(dbEpisodes.map(e => [e.megaphoneEpisodeId, e.id]));

    // Log first episode to inspect field names
    if (episodes?.length) console.log('Megaphone episode sample:', JSON.stringify(episodes[0]));

    // Normalize — Megaphone returns downloads as `totalDownloads` or `downloads`
    const normalized = (Array.isArray(episodes) ? episodes : []).map(ep => ({
      id: internalIdByMegaphone[ep.id] ?? null,  // our internal DB id (for linking)
      megaphoneId: ep.id,
      title: ep.title,
      pubdate: ep.pubdate,
      duration: ep.duration,
      downloads: ep.totalDownloads ?? ep.downloads ?? 0,
    }));

    const totalDownloads = normalized.reduce((sum, ep) => sum + ep.downloads, 0);

    // Fetch podcast-level stats (30-day window)
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let stats = null;
    try {
      stats = await adapter.getPodcastStats(show.megaphoneShowId, { from, to });
    } catch {
      // Stats endpoint optional — don't fail the whole request
    }

    res.json({
      available: true,
      totalDownloads,
      episodes: normalized.sort((a, b) => b.downloads - a.downloads),
      stats,
    });
  } catch (err) {
    res.status(500).json({ available: false, reason: err.message });
  }
});

module.exports = router;

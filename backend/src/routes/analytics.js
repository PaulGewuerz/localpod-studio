const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { getHostingAdapter } = require('../adapters/hosting');
const { sendAnalyticsReportRequest } = require('../email');

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

    // Fetch podcast-level stats (all-time, no date filter)
    let stats = null;
    try {
      stats = await adapter.getPodcastStats(show.megaphoneShowId);
      console.log('Megaphone stats sample:', JSON.stringify(stats).slice(0, 1000));
    } catch (e) {
      console.warn('Stats fetch failed:', e.message);
    }

    // Use stats data for downloads if available — episodes endpoint has no download counts
    const statsEpisodeMap = {};
    const statsEpisodes = stats?.episodes ?? stats?.data ?? [];
    if (Array.isArray(statsEpisodes)) {
      for (const s of statsEpisodes) {
        if (s.id) statsEpisodeMap[s.id] = s.downloads ?? s.total ?? 0;
      }
    }

    const enriched = normalized.map(ep => ({
      ...ep,
      downloads: statsEpisodeMap[ep.megaphoneId] ?? ep.downloads,
    }));

    const totalDownloads2 = enriched.reduce((sum, ep) => sum + ep.downloads, 0)
      || stats?.downloads
      || stats?.total
      || totalDownloads;

    res.json({
      available: true,
      totalDownloads: totalDownloads2,
      episodes: enriched.sort((a, b) => b.downloads - a.downloads),
      stats,
    });
  } catch (err) {
    res.status(500).json({ available: false, reason: err.message });
  }
});

// POST /analytics/request-report — send analytics report request email to admin
router.post('/request-report', async (req, res) => {
  const orgId = req.user.organization.id;
  const { showId } = req.body;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      shows: showId ? { where: { id: showId } } : { orderBy: { createdAt: 'asc' }, take: 1 },
    },
  });

  const show = org?.shows?.[0];

  try {
    await sendAnalyticsReportRequest({
      orgName: org.name,
      showName: show?.name ?? 'Unknown show',
      userEmail: req.user.email,
    });
    res.json({ sent: true });
  } catch (err) {
    console.error('Analytics report request email failed:', err.message);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

module.exports = router;

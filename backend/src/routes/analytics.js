const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { getHostingAdapter } = require('../adapters/hosting');
const op3 = require('../adapters/analytics/op3');
const { sendAnalyticsReportRequest } = require('../email');

// GET /analytics — episode list from Megaphone, download counts from OP3.
// Megaphone's public API has no analytics endpoints (episodes carry no download
// fields; /downloads|/analytics|/metrics all 404 — verified 2026-07), so downloads
// come from the OP3 prefix on the feed. Counts start at prefix install, no backfill.
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

    const [episodes, dbEpisodes] = await Promise.all([
      adapter.getEpisodes(show.megaphoneShowId),
      prisma.episode.findMany({
        where: { show: { organizationId: orgId }, megaphoneEpisodeId: { not: null }, deletedAt: null },
        select: { id: true, megaphoneEpisodeId: true },
      }),
    ]);
    const internalIdByMegaphone = Object.fromEntries(dbEpisodes.map(e => [e.megaphoneEpisodeId, e.id]));

    const feedUrl = show.megaphoneRssUrl || (await adapter.getPodcast(show.megaphoneShowId)).feedUrl;
    const op3ShowUuid = feedUrl ? await op3.getShowUuid(feedUrl) : null;

    // Join OP3 counts onto Megaphone episodes by RSS item guid
    let downloadsByGuid = {};
    let showCounts = null;
    if (op3ShowUuid) {
      const [epCounts, counts] = await Promise.all([
        op3.getEpisodeDownloadCounts(op3ShowUuid),
        op3.getShowDownloadCounts(op3ShowUuid),
      ]);
      downloadsByGuid = Object.fromEntries(epCounts.map(e => [e.itemGuid, e]));
      showCounts = counts;
    }

    const normalized = (Array.isArray(episodes) ? episodes : []).map(ep => ({
      id: internalIdByMegaphone[ep.id] ?? null,
      megaphoneId: ep.id,
      title: ep.title,
      pubdate: ep.pubdate,
      duration: ep.duration,
      downloads: downloadsByGuid[ep.guid]?.downloadsAll ?? 0,
      downloads30: downloadsByGuid[ep.guid]?.downloads30 ?? null,
    }));

    res.json({
      available: true,
      trackingEnabled: !!op3ShowUuid,
      note: op3ShowUuid ? null : 'Download tracking is not connected for this feed yet.',
      totalDownloads: normalized.reduce((sum, ep) => sum + ep.downloads, 0),
      monthlyDownloads: showCounts?.monthlyDownloads ?? null,
      weeklyDownloads: showCounts?.weeklyDownloads ?? null,
      asof: showCounts?.asof ?? null,
      episodes: normalized.sort((a, b) => b.downloads - a.downloads),
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

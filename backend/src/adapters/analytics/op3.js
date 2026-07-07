/**
 * OP3 analytics adapter — download stats via the Open Podcast Prefix Project (op3.dev).
 * Only sees traffic once the show's Megaphone feed carries the OP3 prefix
 * (https://op3.dev/e/), set manually in Megaphone:
 * podcast Settings → Megaphone Settings → Feed Prefixes → Custom.
 * Not settable via the Megaphone API (verified 2026-07: unknown PUT fields are silently ignored).
 */

const BASE_URL = 'https://op3.dev/api/1';

// preview07ce is OP3's public sample token — works for dev; set a real key in prod (https://op3.dev/api/keys)
const token = () => process.env.OP3_API_TOKEN || 'preview07ce';

async function request(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${token()}`, 'Accept': 'application/json' },
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `OP3 API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return data;
}

// OP3 show uuids never change once assigned — cache hits forever, retry misses each call
const showUuidCache = new Map();

/**
 * Resolve the OP3 show uuid for an RSS feed URL.
 * @returns {Promise<string|null>} null if OP3 has never seen the feed (prefix not installed yet)
 */
async function getShowUuid(feedUrl) {
  if (showUuidCache.has(feedUrl)) return showUuidCache.get(feedUrl);
  const data = await request(`/shows/${Buffer.from(feedUrl).toString('base64url')}`);
  const uuid = data?.showUuid ?? null;
  if (uuid) showUuidCache.set(feedUrl, uuid);
  return uuid;
}

/**
 * Per-episode download counts, newest first.
 * @returns {Promise<Array<{itemGuid, title, pubdate, downloads1?, downloads3?, downloads7?, downloads30?, downloadsAll}>>}
 */
async function getEpisodeDownloadCounts(showUuid) {
  const data = await request(`/queries/episode-download-counts?showUuid=${showUuid}`);
  return data?.episodes ?? [];
}

/**
 * Show-level rollup.
 * @returns {Promise<{monthlyDownloads, weeklyDownloads: number[], weeklyAvgDownloads, numWeeks, asof}|null>}
 */
async function getShowDownloadCounts(showUuid) {
  const data = await request(`/queries/show-download-counts?showUuid=${showUuid}`);
  const counts = data?.showDownloadCounts?.[showUuid];
  return counts ? { ...counts, asof: data.asof } : null;
}

module.exports = { getShowUuid, getEpisodeDownloadCounts, getShowDownloadCounts };

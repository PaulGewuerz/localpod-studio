const Parser = require('rss-parser');

const parser = new Parser({ timeout: 20_000 });
const UA = 'LocalPodStudio/1.0 (+https://localpod.co)';
const COMMON_FEED_PATHS = ['/feed/', '/feed', '/rss', '/rss.xml', '/index.xml', '/atom.xml', '/?feed=rss2'];

/**
 * Article-source layer for the automatic episode flow. Every source type
 * (rss now; sitemap + scrape in later stages) resolves to the same normalized
 * shape so the poller's claim → extract → digest pipeline is source-agnostic.
 *
 *   normalized item: { guid, url, title, publishedAt: Date|null, raw }
 *   - `raw` is the original rss item (carries content:encoded/summary for
 *     in-feed text); empty {} for sources that only yield links.
 */

function normalizeRssItems(feed) {
  return (feed.items || [])
    .map(item => ({
      guid: item.guid || item.link || null,
      url: item.link || null,
      title: item.title || null,
      publishedAt: item.isoDate ? new Date(item.isoDate)
        : item.pubDate ? new Date(item.pubDate) : null,
      raw: item,
    }))
    .filter(i => i.guid);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function tryParseFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items && feed.items.length) ? feed : null;
  } catch {
    return null;
  }
}

/** Find a declared RSS/Atom feed link in an HTML document's <head>. */
function findFeedLinkInHtml(html, baseUrl) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (/rel=["']?alternate/i.test(tag) && /type=["']?application\/(rss|atom)\+xml/i.test(tag)) {
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      if (href) {
        try { return new URL(href, baseUrl).href; } catch { /* skip bad href */ }
      }
    }
  }
  return null;
}

function buildResult(sourceType, resolvedUrl, feed) {
  return {
    ok: true,
    sourceType,
    resolvedUrl,
    itemCount: (feed.items || []).length,
    sampleTitles: (feed.items || []).slice(0, 5).map(i => i.title).filter(Boolean),
  };
}

/**
 * Given a URL a user pasted (feed, or a homepage to discover from), find a
 * usable article source. Stage 1 resolves RSS/Atom only — directly, via a
 * declared <link>, or via common feed paths.
 *
 * @returns {Promise<{ ok: true, sourceType, resolvedUrl, itemCount, sampleTitles } | { ok: false, error }>}
 */
async function detectSource(inputUrl) {
  let url = String(inputUrl || '').trim();
  if (!url) return { ok: false, error: 'Enter a URL first.' };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  let origin;
  try { origin = new URL(url).origin; }
  catch { return { ok: false, error: 'That doesn’t look like a valid URL.' }; }

  // 1) Already a feed?
  let feed = await tryParseFeed(url);
  if (feed) return buildResult('rss', url, feed);

  // 2) Fetch the page and look for a declared feed link.
  let html;
  try {
    html = await fetchText(url);
  } catch (e) {
    return { ok: false, error: `Couldn’t fetch that URL (${e.message}).` };
  }
  const declared = findFeedLinkInHtml(html, url);
  if (declared) {
    feed = await tryParseFeed(declared);
    if (feed) return buildResult('rss', declared, feed);
  }

  // 3) Try common feed paths.
  for (const path of COMMON_FEED_PATHS) {
    feed = await tryParseFeed(origin + path);
    if (feed) return buildResult('rss', origin + path, feed);
  }

  return {
    ok: false,
    error: 'No RSS feed found at this URL. Sitemap and homepage-scraping sources are coming soon.',
  };
}

/**
 * Fetch normalized candidate articles for a show, dispatching on its sourceType.
 * @returns {Promise<Array<{ guid, url, title, publishedAt, raw }>>}
 */
async function discoverArticles(show) {
  const type = show.sourceType || 'rss';
  if (type === 'rss') {
    const feed = await parser.parseURL(show.feedUrl);
    return normalizeRssItems(feed);
  }
  throw new Error(`source type "${type}" not yet supported`);
}

module.exports = { detectSource, discoverArticles };

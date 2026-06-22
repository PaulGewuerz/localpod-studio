const Parser = require('rss-parser');

const parser = new Parser({ timeout: 20_000 });
const UA = 'LocalPodStudio/1.0 (+https://localpod.co)';
const COMMON_FEED_PATHS = ['/feed/', '/feed', '/rss', '/rss.xml', '/index.xml', '/atom.xml', '/?feed=rss2'];
const COMMON_SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml',
  '/news-sitemap.xml', '/sitemap-news.xml', '/sitemap_news.xml', '/post-sitemap.xml'];

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

// ── Sitemap support ─────────────────────────────────────────────────────────

function stripCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function looksLikeSitemap(xml) {
  return /<(urlset|sitemapindex)\b/i.test(xml);
}

/** All inner contents of <tag>…</tag> blocks (non-namespaced container tags). */
function blockMatches(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/** First <tag>…</tag> value within a block (handles namespaced + CDATA). */
function firstTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? stripCdata(m[1]) : null;
}

/** Readable-ish title from a URL slug, for previews when no <news:title>. */
function slugTitleFromUrl(u) {
  try {
    const seg = new URL(u).pathname.split('/').filter(Boolean).pop() || '';
    const t = seg.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim();
    return t || u;
  } catch { return u; }
}

function dedupeSortLimit(items, max) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it.url || seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  out.sort((a, b) => (b.publishedAt ? b.publishedAt.getTime() : 0) - (a.publishedAt ? a.publishedAt.getTime() : 0));
  return out.slice(0, max);
}

/**
 * Fetch a sitemap (urlset or sitemapindex) and return normalized article items,
 * newest first. Sitemap indexes are followed (news/article/post children first,
 * then most recently modified), bounded by depth and count.
 */
async function fetchSitemapItems(url, { maxUrls = 40, _depth = 0 } = {}) {
  const xml = await fetchText(url);

  if (/<sitemapindex\b/i.test(xml)) {
    if (_depth >= 2) return [];
    const children = blockMatches(xml, 'sitemap')
      .map(b => ({ loc: firstTag(b, 'loc'), lastmod: firstTag(b, 'lastmod') }))
      .filter(c => c.loc);
    children.sort((a, b) => {
      const pa = /news|article|post|story/i.test(a.loc) ? 0 : 1;
      const pb = /news|article|post|story/i.test(b.loc) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.lastmod ? Date.parse(b.lastmod) || 0 : 0) - (a.lastmod ? Date.parse(a.lastmod) || 0 : 0);
    });
    const items = [];
    for (const c of children.slice(0, 3)) {
      try {
        items.push(...await fetchSitemapItems(c.loc, { maxUrls, _depth: _depth + 1 }));
      } catch { /* skip bad child sitemap */ }
      if (items.length >= maxUrls) break;
    }
    return dedupeSortLimit(items, maxUrls);
  }

  const items = blockMatches(xml, 'url').map(block => {
    const loc = firstTag(block, 'loc');
    if (!loc) return null;
    const pubStr = firstTag(block, 'news:publication_date') || firstTag(block, 'lastmod');
    const pub = pubStr ? new Date(pubStr) : null;
    return {
      guid: loc,
      url: loc,
      title: firstTag(block, 'news:title') || null,
      publishedAt: pub && !isNaN(pub) ? pub : null,
      raw: {},
    };
  }).filter(Boolean);

  return dedupeSortLimit(items, maxUrls);
}

/** Find a usable sitemap for a site: the input itself, robots.txt, or common paths. */
async function discoverSitemap(origin, inputUrl, maybeSitemapXml) {
  if (maybeSitemapXml && looksLikeSitemap(maybeSitemapXml)) {
    const items = await fetchSitemapItems(inputUrl, { maxUrls: 5 }).catch(() => []);
    if (items.length) return { url: inputUrl, items };
  }

  const candidates = [];
  try {
    const robots = await fetchText(origin + '/robots.txt');
    for (const m of robots.matchAll(/Sitemap:\s*(\S+)/gi)) candidates.push(m[1].trim());
  } catch { /* no robots.txt */ }
  for (const p of COMMON_SITEMAP_PATHS) candidates.push(origin + p);

  for (const candidate of [...new Set(candidates)]) {
    const items = await fetchSitemapItems(candidate, { maxUrls: 5 }).catch(() => []);
    if (items.length) return { url: candidate, items };
  }
  return null;
}

// ── Homepage scraping ───────────────────────────────────────────────────────

// Path segments that signal a non-article (nav/utility) link.
const NON_ARTICLE_RE = /\/(tag|tags|category|categories|topic|topics|section|sections|author|authors|about|contact|privacy|terms|subscribe|signin|sign-in|login|register|account|search|feed|rss|cart|shop|advertise|advertising|newsletter|jobs|careers|events|page|wp-admin)(\/|$|\?)/i;
const NON_ARTICLE_EXT_RE = /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp3|mp4|xml|json|css|js)$/i;

function isArticleLikePath(path) {
  if (path === '/' || path === '') return false;
  if (NON_ARTICLE_RE.test(path)) return false;
  if (NON_ARTICLE_EXT_RE.test(path)) return false;
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1] || '';
  const slugWords = last.split('-').filter(Boolean).length;
  const hasDate = /\/(19|20)\d\d\//.test(path);
  return hasDate || slugWords >= 3 || (segs.length >= 2 && slugWords >= 2);
}

function scoreLink(path, text) {
  let s = 0;
  if (/\/(19|20)\d\d\//.test(path)) s += 3;                       // dated URL
  const last = path.split('/').filter(Boolean).pop() || '';
  s += Math.min(4, last.split('-').filter(Boolean).length);      // slug words
  s += Math.min(3, Math.floor(text.length / 30));                // headline length
  return s;
}

/**
 * Extract candidate article links from a page's HTML. With a CSS selector, takes
 * the anchor at/within/around each matched element (escape hatch for messy
 * sites). Without one, falls back to heuristics over same-site <a> tags
 * (article-like path + headline-length link text). Returns normalized items.
 */
function scrapeArticleLinks(html, baseUrl, { selector, max = 25 } = {}) {
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(html, { url: baseUrl }).window.document;
  const origin = new URL(baseUrl).origin;

  let anchors;
  if (selector) {
    anchors = [];
    for (const el of doc.querySelectorAll(selector)) {
      const a = el.tagName === 'A' ? el : (el.querySelector('a') || el.closest('a'));
      if (a) anchors.push(a);
    }
  } else {
    anchors = [...doc.querySelectorAll('a[href]')];
  }

  const seen = new Set();
  const candidates = [];
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    let abs;
    try { abs = new URL(href, baseUrl); } catch { continue; }
    if (abs.origin !== origin || !/^https?:$/.test(abs.protocol)) continue;

    const path = abs.pathname;
    const clean = abs.origin + path.replace(/\/$/, '');
    if (seen.has(clean)) continue;

    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (selector) {
      if (path === '/' || path === '') continue;
    } else {
      if (!isArticleLikePath(path) || text.length < 25) continue;
    }

    seen.add(clean);
    candidates.push({ url: clean, title: text || null, score: scoreLink(path, text) });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, max).map(c => ({
    guid: c.url, url: c.url, title: c.title, publishedAt: null, raw: {},
  }));
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

  // 4) Fall back to a sitemap (the input itself, robots.txt, or common paths).
  const sm = await discoverSitemap(origin, url, html);
  if (sm) {
    return {
      ok: true,
      sourceType: 'sitemap',
      resolvedUrl: sm.url,
      sampleTitles: sm.items.slice(0, 5).map(i => i.title || slugTitleFromUrl(i.url)),
    };
  }

  // 5) Last resort: scrape article links from the page itself.
  try {
    const links = scrapeArticleLinks(html, url, { max: 10 });
    if (links.length >= 3) {
      return {
        ok: true,
        sourceType: 'scrape',
        resolvedUrl: url,
        sampleTitles: links.slice(0, 5).map(i => i.title || slugTitleFromUrl(i.url)),
      };
    }
  } catch { /* scrape failed */ }

  return {
    ok: false,
    error: 'Couldn’t find articles at this URL — no feed, sitemap, or recognizable article links. Try a section page (e.g. /news), or set a link selector under Advanced.',
  };
}

/**
 * Preview a scrape selector against a page (powers the Settings Test button when
 * a custom link selector is set). Returns the same shape as detectSource.
 */
async function previewScrape(inputUrl, selector) {
  let url = String(inputUrl || '').trim();
  if (!url) return { ok: false, error: 'Enter a URL first.' };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  let html;
  try { html = await fetchText(url); }
  catch (e) { return { ok: false, error: `Couldn’t fetch that URL (${e.message}).` }; }

  let items;
  try { items = scrapeArticleLinks(html, url, { selector: selector || null, max: 10 }); }
  catch { return { ok: false, error: 'That selector isn’t valid.' }; }

  if (!items.length) {
    return { ok: false, error: 'No article links matched. Try a different selector or section page.' };
  }
  return {
    ok: true,
    sourceType: 'scrape',
    resolvedUrl: url,
    sampleTitles: items.slice(0, 5).map(i => i.title || slugTitleFromUrl(i.url)),
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
  if (type === 'sitemap') {
    return fetchSitemapItems(show.feedUrl, { maxUrls: 40 });
  }
  if (type === 'scrape') {
    const html = await fetchText(show.feedUrl);
    const selector = show.sourceConfig?.linkSelector || null;
    return scrapeArticleLinks(html, show.feedUrl, { selector, max: 25 });
  }
  throw new Error(`source type "${type}" not yet supported`);
}

module.exports = { detectSource, discoverArticles, previewScrape };

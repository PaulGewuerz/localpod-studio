const { htmlToText } = require('./htmlToText');

const UA = 'LocalPodStudio/1.0 (+https://localpod.co)';

/**
 * Fetch an article page and extract its readable title + body text via
 * Readability. Shared by the feed poller (page-fetch fallback) and the manual
 * paste-a-URL flow.
 *
 * @param {string} url
 * @returns {Promise<{ title: string|null, text: string }>}
 * @throws on network / non-2xx
 */
async function fetchPageArticle(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const { JSDOM } = require('jsdom');
  const { Readability } = require('@mozilla/readability');
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  return { title: article?.title || null, text: htmlToText(article?.content || '') };
}

module.exports = { fetchPageArticle };

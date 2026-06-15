const Parser = require('rss-parser');
const prisma = require('../prisma');
const { generateDraftEpisode } = require('../services/generateEpisode');
const { htmlToText } = require('../utils/htmlToText');

const parser = new Parser({ timeout: 20_000 });

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 30_000;
const MAX_GENERATED_PER_SHOW_PER_POLL = 5; // safety cap on TTS spend per cycle
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000; // never generate backlog older than 48h
const MIN_ARTICLE_CHARS = 400; // below this, feed content is a teaser — fetch the page instead

/**
 * Get article text for a feed item: prefer full content embedded in the feed,
 * fall back to fetching the article page and extracting readable content.
 */
async function extractArticleText(item) {
  const fromFeed = htmlToText(item['content:encoded'] || item.content || item.summary || '');
  if (fromFeed.length >= MIN_ARTICLE_CHARS) return fromFeed;

  if (item.link) {
    try {
      const res = await fetch(item.link, {
        headers: { 'User-Agent': 'LocalPodStudio/1.0 (+https://localpod.co)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const { JSDOM } = require('jsdom');
        const { Readability } = require('@mozilla/readability');
        const dom = new JSDOM(await res.text(), { url: item.link });
        const article = new Readability(dom.window.document).parse();
        const fromPage = htmlToText(article?.content || '');
        if (fromPage.length > fromFeed.length) return fromPage;
      }
    } catch (err) {
      console.error(`[feed-poller] page fetch failed for ${item.link}:`, err.message);
    }
  }
  return fromFeed;
}

async function pollShow(show) {
  const feed = await parser.parseURL(show.feedUrl);
  const items = (feed.items || []).slice(0, 20); // newest items only
  let generated = 0;

  for (const item of items) {
    if (generated >= MAX_GENERATED_PER_SHOW_PER_POLL) break;

    const guid = item.guid || item.link;
    if (!guid) continue;

    // Claim the item via the (showId, guid) unique constraint — if the row
    // already exists this item was handled (or is being handled) before.
    let record;
    try {
      record = await prisma.ingestedArticle.create({
        data: { showId: show.id, guid, url: item.link || null, title: item.title || null },
      });
    } catch {
      continue;
    }

    const pubDate = item.isoDate ? new Date(item.isoDate)
      : item.pubDate ? new Date(item.pubDate) : null;
    if (pubDate && !isNaN(pubDate) && Date.now() - pubDate.getTime() > MAX_ARTICLE_AGE_MS) {
      await prisma.ingestedArticle.update({
        where: { id: record.id },
        data: { status: 'skipped', error: 'older than 48h at first poll' },
      });
      continue;
    }

    try {
      const text = await extractArticleText(item);
      if (text.length < MIN_ARTICLE_CHARS) {
        throw new Error(`article text too short (${text.length} chars)`);
      }

      const voiceDbId = show.automationVoiceId || show.organization.defaultVoiceId;
      if (!voiceDbId) throw new Error('no voice configured — set a show automation voice or org default voice');
      const voice = await prisma.voice.findUnique({ where: { id: voiceDbId } });
      if (!voice) throw new Error('configured voice not found');

      const episode = await generateDraftEpisode({
        org: show.organization,
        show,
        voiceElevenLabsId: voice.elevenLabsId,
        articleText: text,
        title: item.title || 'Untitled Episode',
        description: htmlToText(item.contentSnippet || item.summary || '').slice(0, 500) || null,
      });

      await prisma.ingestedArticle.update({
        where: { id: record.id },
        data: { status: 'generated', episodeId: episode.id },
      });
      generated++;
      console.log(`[feed-poller] draft created: "${episode.title}" (show: ${show.name})`);
    } catch (err) {
      console.error(`[feed-poller] failed on "${item.title}" (show: ${show.name}):`, err.message);
      await prisma.ingestedArticle.update({
        where: { id: record.id },
        data: { status: 'failed', error: String(err.message).slice(0, 500) },
      }).catch(() => {});
      // Org is out of characters — no point trying further items this cycle
      if (err.code === 'character_limit_exceeded') break;
    }
  }
}

let polling = false;

async function pollAllFeeds() {
  if (polling) return;
  polling = true;
  try {
    const shows = await prisma.show.findMany({
      where: { automationEnabled: true, feedUrl: { not: null } },
      include: { organization: { include: { subscription: true } } },
    });
    for (const show of shows) {
      try {
        await pollShow(show);
      } catch (err) {
        console.error(`[feed-poller] feed error for show ${show.id} (${show.feedUrl}):`, err.message);
      }
    }
  } catch (err) {
    console.error('[feed-poller] poll cycle failed:', err.message);
  } finally {
    polling = false;
  }
}

function startFeedPoller() {
  const enabled = process.env.NODE_ENV === 'production' || process.env.ENABLE_FEED_POLLER === 'true';
  if (!enabled) {
    console.log('[feed-poller] disabled outside production (set ENABLE_FEED_POLLER=true to run locally)');
    return;
  }
  setTimeout(pollAllFeeds, INITIAL_DELAY_MS);
  setInterval(pollAllFeeds, POLL_INTERVAL_MS);
  console.log('[feed-poller] started — polling every 15 minutes');
}

module.exports = { startFeedPoller, pollAllFeeds };

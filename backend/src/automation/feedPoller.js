const prisma = require('../prisma');
const { generateDigestEpisode } = require('../services/generateEpisode');
const { discoverArticles } = require('./articleSource');
const { fetchPageArticle } = require('../utils/extractArticle');
const { htmlToText } = require('../utils/htmlToText');

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 30_000;
const MAX_ARTICLES_PER_DIGEST = 10;   // safety cap on TTS spend per digest
const FIRST_RUN_MAX_AGE_MS = 48 * 60 * 60 * 1000; // first run never reaches back further than this
const MIN_ARTICLE_CHARS = 400;        // below this, feed content is a teaser — fetch the page instead

/**
 * Get article text for a normalized source item: prefer full content embedded
 * in the feed (rss only), fall back to fetching the article page and extracting
 * readable content (the only path for link-only sources like sitemap/scrape).
 */
async function extractArticleText(item) {
  const raw = item.raw || {};
  const fromFeed = htmlToText(raw['content:encoded'] || raw.content || raw.summary || '');
  if (fromFeed.length >= MIN_ARTICLE_CHARS) return fromFeed;

  if (item.url) {
    try {
      const { text: fromPage } = await fetchPageArticle(item.url);
      if (fromPage.length > fromFeed.length) return fromPage;
    } catch (err) {
      console.error(`[feed-poller] page fetch failed for ${item.url}:`, err.message);
    }
  }
  return fromFeed;
}

/** Advance a run clock by intervalDays until it is in the future. */
function advanceRunClock(from, intervalDays, now) {
  const next = new Date(from.getTime());
  const stepMs = intervalDays * 24 * 60 * 60 * 1000;
  do { next.setTime(next.getTime() + stepMs); } while (next.getTime() <= now.getTime());
  return next;
}

/**
 * Process one due show: collect everything new in its feed since the last run,
 * combine into a single digest draft episode, then advance the run clock.
 */
async function runShowDigest(show, now) {
  const since = show.automationLastRunAt
    ?? new Date(Math.max(
      (show.automationStartAt ?? show.automationNextRunAt ?? now).getTime(),
      now.getTime() - FIRST_RUN_MAX_AGE_MS,
    ));

  const items = (await discoverArticles(show)).slice(0, 30);

  // Claim new items (newest first), keeping those published since the last run.
  const claimed = [];
  for (const item of items) {
    if (!item.guid) continue;

    let record;
    try {
      record = await prisma.ingestedArticle.create({
        data: { showId: show.id, guid: item.guid, url: item.url || null, title: item.title || null },
      });
    } catch {
      continue; // already seen in a prior run
    }

    const pub = item.publishedAt && !isNaN(item.publishedAt) ? item.publishedAt : null;
    if (pub && pub.getTime() < since.getTime()) {
      await prisma.ingestedArticle.update({
        where: { id: record.id },
        data: { status: 'skipped', error: 'published before this run window' },
      });
      continue;
    }
    claimed.push({ item, record });
  }

  const advanceClock = async (lastRun) => {
    const base = show.automationNextRunAt ?? show.automationStartAt ?? lastRun;
    const nextRunAt = advanceRunClock(base, show.automationIntervalDays, now);
    await prisma.show.update({
      where: { id: show.id },
      data: { automationLastRunAt: lastRun, automationNextRunAt: nextRunAt },
    });
  };

  if (!claimed.length) {
    console.log(`[feed-poller] ${show.name}: nothing new this run`);
    await advanceClock(now);
    return;
  }

  // Build digest segments (cap spend), extracting + length-checking each article.
  const segments = [];
  const usedRecordIds = [];
  for (const { item, record } of claimed) {
    if (segments.length >= MAX_ARTICLES_PER_DIGEST) {
      await prisma.ingestedArticle.update({
        where: { id: record.id }, data: { status: 'skipped', error: 'over per-digest article cap' },
      });
      continue;
    }
    const text = await extractArticleText(item);
    if (text.length < MIN_ARTICLE_CHARS) {
      await prisma.ingestedArticle.update({
        where: { id: record.id },
        data: { status: 'skipped', error: `article text too short (${text.length} chars)` },
      });
      continue;
    }
    segments.push({ title: item.title || 'Untitled', text });
    usedRecordIds.push(record.id);
  }

  if (!segments.length) {
    console.log(`[feed-poller] ${show.name}: new items but no usable article text`);
    await advanceClock(now);
    return;
  }

  const voiceDbId = show.automationVoiceId || show.organization.defaultVoiceId;
  const voice = voiceDbId ? await prisma.voice.findUnique({ where: { id: voiceDbId } }) : null;
  if (!voice) {
    console.error(`[feed-poller] ${show.name}: no voice configured — skipping run`);
    await prisma.ingestedArticle.updateMany({
      where: { id: { in: usedRecordIds } },
      data: { status: 'failed', error: 'no voice configured for automation' },
    });
    await advanceClock(now);
    return;
  }

  const digestTitle = segments.length === 1
    ? segments[0].title
    : `${show.name} digest — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const firstRaw = claimed[0].item.raw || {};
  const description = segments.length === 1
    ? (htmlToText(firstRaw.contentSnippet || firstRaw.summary || '').slice(0, 500) || null)
    : `Featuring: ${segments.map(s => s.title).join(' • ')}`.slice(0, 500);

  try {
    const episode = await generateDigestEpisode({
      org: show.organization,
      show,
      voiceElevenLabsId: voice.elevenLabsId,
      segments,
      title: digestTitle,
      description,
    });
    await prisma.ingestedArticle.updateMany({
      where: { id: { in: usedRecordIds } },
      data: { status: 'generated', episodeId: episode.id },
    });
    console.log(`[feed-poller] digest draft created: "${episode.title}" (${segments.length} article(s), show: ${show.name})`);
  } catch (err) {
    console.error(`[feed-poller] digest failed (show: ${show.name}):`, err.message);
    await prisma.ingestedArticle.updateMany({
      where: { id: { in: usedRecordIds } },
      data: { status: 'failed', error: String(err.message).slice(0, 500) },
    });
  }

  await advanceClock(now);
}

let polling = false;

async function pollAllFeeds() {
  if (polling) return;
  polling = true;
  const now = new Date();
  try {
    const shows = await prisma.show.findMany({
      where: {
        automationEnabled: true,
        feedUrl: { not: null },
        automationIntervalDays: { not: null },
      },
      include: { organization: { include: { subscription: true } } },
    });

    for (const show of shows) {
      // Initialize the run clock from the configured start, if unset.
      let nextRunAt = show.automationNextRunAt;
      if (!nextRunAt) {
        if (!show.automationStartAt) continue; // not fully configured yet
        nextRunAt = show.automationStartAt;
        await prisma.show.update({
          where: { id: show.id }, data: { automationNextRunAt: nextRunAt },
        });
        show.automationNextRunAt = nextRunAt;
      }

      if (nextRunAt.getTime() > now.getTime()) continue; // not due yet

      try {
        await runShowDigest(show, now);
      } catch (err) {
        console.error(`[feed-poller] feed error for show ${show.id} (${show.feedUrl}):`, err.message);
        // Don't let a feed-parse failure wedge the clock — push it to the next interval.
        try {
          await prisma.show.update({
            where: { id: show.id },
            data: { automationNextRunAt: advanceRunClock(nextRunAt, show.automationIntervalDays, now) },
          });
        } catch { /* ignore */ }
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

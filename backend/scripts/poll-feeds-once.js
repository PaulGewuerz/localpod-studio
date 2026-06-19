/**
 * Fire one automation poll cycle on demand and report what happened — so you can
 * test the automatic episode flow without waiting for the 15-minute prod poller.
 *
 * Runs pollAllFeeds() once against the configured DB. Any show whose nextRunAt is
 * due will be processed (a digest draft generated — this WILL spend ElevenLabs
 * credits if there are new articles). Feed-parse failures and per-article skips
 * are printed, surfacing problems the dashboard doesn't yet show.
 *
 *   node scripts/poll-feeds-once.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/prisma');
const { pollAllFeeds } = require('../src/automation/feedPoller');

function fmt(d) { return d ? d.toISOString() : '—'; }

async function snapshot() {
  const shows = await prisma.show.findMany({
    where: { automationEnabled: true },
    select: { id: true, name: true, feedUrl: true, automationIntervalDays: true,
      automationNextRunAt: true, automationLastRunAt: true },
  });
  return shows;
}

async function main() {
  const now = new Date();
  console.log(`\n[poll-once] now: ${now.toISOString()}\n`);

  const before = await snapshot();
  if (!before.length) {
    console.log('No shows have automation enabled. Nothing to do.');
    return;
  }

  for (const s of before) {
    const due = s.automationNextRunAt ? now >= s.automationNextRunAt : false;
    console.log(`• ${s.name}: nextRunAt=${fmt(s.automationNextRunAt)} due=${due} feed=${s.feedUrl}`);
  }

  console.log('\n[poll-once] running pollAllFeeds()…\n');
  await pollAllFeeds();

  console.log('\n[poll-once] result:\n');
  const after = await prisma.show.findMany({
    where: { automationEnabled: true },
    select: { id: true, name: true, automationNextRunAt: true, automationLastRunAt: true,
      episodes: { where: { createdAt: { gte: now } }, select: { id: true, title: true, status: true } },
      ingestedArticles: { where: { createdAt: { gte: now } }, select: { status: true, title: true, error: true } } },
  });
  for (const s of after) {
    console.log(`• ${s.name}: lastRunAt=${fmt(s.automationLastRunAt)} nextRunAt=${fmt(s.automationNextRunAt)}`);
    s.episodes.forEach(e => console.log(`    NEW EPISODE [${e.status}] ${e.title} (${e.id})`));
    s.ingestedArticles.forEach(a => console.log(`    article [${a.status}] ${a.title || ''}${a.error ? ' — ' + a.error : ''}`));
    if (!s.episodes.length && !s.ingestedArticles.length) console.log('    (no new episodes or articles this run)');
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

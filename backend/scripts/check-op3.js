// One-off: verify OP3 analytics are live for provisioned shows. Read-only.
require('dotenv').config();
const prisma = require('../src/prisma');
const op3 = require('../src/adapters/analytics/op3');

(async () => {
  console.log('OP3_API_TOKEN:', process.env.OP3_API_TOKEN ? 'set (real key)' : 'NOT set — using sample token preview07ce');
  const shows = await prisma.show.findMany({
    where: { megaphoneRssUrl: { not: null } },
    select: { name: true, megaphoneRssUrl: true },
  });
  console.log(`\nProvisioned shows with a feed URL: ${shows.length}\n`);

  for (const s of shows) {
    try {
      const uuid = await op3.getShowUuid(s.megaphoneRssUrl);
      if (!uuid) {
        console.log(`❌ ${s.name} — OP3 has never seen this feed (prefix not installed / not yet crawled)`);
        continue;
      }
      const roll = await op3.getShowDownloadCounts(uuid);
      const eps = await op3.getEpisodeDownloadCounts(uuid);
      const totalAll = eps.reduce((n, e) => n + (e.downloadsAll || 0), 0);
      console.log(`✅ ${s.name} — uuid ${uuid}`);
      console.log(`     monthly=${roll?.monthlyDownloads ?? 'n/a'} | episodes tracked=${eps.length} | all-time downloads=${totalAll} | asof=${roll?.asof ?? 'n/a'}`);
    } catch (err) {
      console.log(`⚠️  ${s.name} — OP3 error: ${err.message}`);
    }
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });

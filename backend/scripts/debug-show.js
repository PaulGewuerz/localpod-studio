require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/prisma');

async function main() {
  const show = await prisma.show.findFirst({
    where: { name: { contains: 'Texas', mode: 'insensitive' } },
  });
  if (!show) return console.log('Show not found');
  console.log('Show:', show.id, show.name);

  const episodes = await prisma.episode.findMany({
    where: { showId: show.id },
    select: { id: true, title: true, status: true, characterCount: true, deletedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Total episodes in DB: ${episodes.length}`);
  episodes.forEach(e => console.log(
    `  [${e.status}] ${e.title} | chars: ${e.characterCount} | deleted: ${e.deletedAt} | created: ${e.createdAt}`
  ));
}

main().catch(console.error).finally(() => prisma.$disconnect());

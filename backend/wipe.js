require('dotenv').config();
const prisma = require('./src/prisma');

async function wipe() {
  await prisma.episode.deleteMany();
  await prisma.pronunciationRule.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.show.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  console.log('All accounts wiped');
  await prisma.$disconnect();
}

wipe();

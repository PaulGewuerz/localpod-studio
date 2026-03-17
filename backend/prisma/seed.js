require('dotenv').config()
process.env.DATABASE_URL = process.env.DATABASE_URL

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const voices = [
    { name: 'Ava', elevenLabsId: 'BHf91PCMVcVwq6r1ku7L', description: 'Warm and conversational' },
    { name: 'Brian', elevenLabsId: 'nPczCjzI2devNBz1zQrb', description: 'Clear and authoritative' },
    { name: 'Edwin', elevenLabsId: 'CMUEYyUNA4TrldQy4HLM', description: 'Smooth and professional' },
    { name: 'Emily', elevenLabsId: 'VUGQSU6BSEjkbudnJbOj', description: 'Friendly and engaging' },
    { name: 'Shayla', elevenLabsId: 'p4M8XW4N954o56wN9vKM', description: 'Bright and energetic' },
    { name: 'Thomas', elevenLabsId: 'FzF9ACIefsb6wbrYVjf1', description: 'Deep and trustworthy' },
  ]

  for (const voice of voices) {
    await prisma.voice.upsert({
      where: { elevenLabsId: voice.elevenLabsId },
      update: {},
      create: voice,
    })
  }

  console.log('Voices seeded successfully')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
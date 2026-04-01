require('dotenv').config()
process.env.DATABASE_URL = process.env.DATABASE_URL

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const voices = [
    { name: 'Ava',     elevenLabsId: 'BHf91PCMVcVwq6r1ku7L', description: 'Warm and conversational' },
    { name: 'Brian',   elevenLabsId: 'nPczCjzI2devNBz1zQrb', description: 'Clear and authoritative' },
    { name: 'Daniel',  elevenLabsId: 'onwK4e9ZLuTAKqWW03F9', description: 'Steady broadcaster' },
    { name: 'Alice',   elevenLabsId: 'Xb7hH8MSUJpSbSDYk0k2', description: 'Clear and engaging' },
    { name: 'Matilda', elevenLabsId: 'XrExE9yKIg1WjnnlVkGX', description: 'Knowledgeable and professional' },
    { name: 'George',  elevenLabsId: 'JBFqnCBsd6RMkjVDRZzb', description: 'Warm and captivating' },
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
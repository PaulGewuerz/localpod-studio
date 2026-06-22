require('dotenv').config()
process.env.DATABASE_URL = process.env.DATABASE_URL

const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const voices = [
    { name: 'Ava',      elevenLabsId: 'BHf91PCMVcVwq6r1ku7L', description: 'Warm and conversational' },
    { name: 'Brian',    elevenLabsId: 'nPczCjzI2devNBz1zQrb', description: 'Clear and authoritative' },
    { name: 'Matilda',  elevenLabsId: 'XrExE9yKIg1WjnnlVkGX', description: 'Knowledgeable and professional' },
    { name: 'Karen',    elevenLabsId: 'GkP5h0UAcZQ2i4aDPipF', description: 'Dynamic, smooth and clear' },
    { name: 'William',  elevenLabsId: 'l7PKZGTaZgsdjGbTQRfS', description: 'The engaging storyteller' },
    { name: 'Russ',     elevenLabsId: 'HKFOb9iktHA85uKXydRT', description: 'Deep, smooth and articulate' },
    { name: 'Kary',     elevenLabsId: '4rwC6xlwNjrg40xWm8Vb', description: 'Clear, natural and light' },
    { name: 'Jonathon', elevenLabsId: 'oyxaSt75JW8l04MCJaSo', description: 'Professional, calm and even' },
    { name: 'Ivanna',   elevenLabsId: '0S5oIfi8zOZixuSj8K6n', description: 'Upbeat and engaging narrator' },
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
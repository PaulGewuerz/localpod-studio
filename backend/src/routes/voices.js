const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

router.get('/', async (req, res) => {
  // Fetch our curated voice list from DB
  const dbVoices = await prisma.voice.findMany({
    select: { id: true, name: true, elevenLabsId: true, description: true },
  });

  // Fetch preview URLs from ElevenLabs
  let previewMap = {};
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    });
    if (response.ok) {
      const { voices } = await response.json();
      for (const v of voices) {
        previewMap[v.voice_id] = v.preview_url;
      }
    }
  } catch (err) {
    console.error('Failed to fetch ElevenLabs voices:', err.message);
  }

  const voices = dbVoices.map(v => ({
    ...v,
    previewUrl: previewMap[v.elevenLabsId] || null,
  }));

  res.json(voices);
});

module.exports = router;

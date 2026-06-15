const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { generateDraftEpisode, GenerationError } = require('../services/generateEpisode');

router.post('/', async (req, res) => {
  const { articleText, voiceId, title, description, showId } = req.body;
  if (!articleText) return res.status(400).json({ error: 'articleText is required' });
  if (!voiceId)     return res.status(400).json({ error: 'voiceId is required' });

  const org = req.user.organization;

  const show = showId
    ? await prisma.show.findFirst({ where: { id: showId, organizationId: org.id } })
    : await prisma.show.findFirst({ where: { organizationId: org.id } });
  if (!show) return res.status(400).json({ error: 'No show configured for this organization' });

  try {
    const episode = await generateDraftEpisode({
      org,
      show,
      voiceElevenLabsId: voiceId,
      articleText,
      title,
      description,
    });
    res.json({ episodeId: episode.id, audioUrl: episode.audioUrl });
  } catch (err) {
    if (err instanceof GenerationError) {
      if (err.code === 'character_limit_exceeded') {
        return res.status(402).json({ error: 'character_limit_exceeded' });
      }
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Generate error:', err.message);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

module.exports = router;

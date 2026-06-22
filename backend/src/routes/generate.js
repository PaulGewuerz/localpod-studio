const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { generateDraftEpisode, generateDigestEpisode, GenerationError } = require('../services/generateEpisode');
const { fetchPageArticle } = require('../utils/extractArticle');

const MIN_ARTICLE_CHARS = 400;
const MAX_URLS = 10;

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

// POST /generate/from-urls — fetch one or more article URLs, extract readable
// text via Readability, and generate a draft. Multiple URLs become one digest
// (reusing the automatic-flow pipeline: junk-text cleanup + show ad selections).
router.post('/from-urls', async (req, res) => {
  const { urls, voiceId, title, showId } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls (array) is required' });
  }
  if (!voiceId) return res.status(400).json({ error: 'voiceId is required' });

  const cleanUrls = [...new Set(
    urls.map(u => String(u || '').trim()).filter(Boolean)
  )].slice(0, MAX_URLS);
  if (!cleanUrls.length) return res.status(400).json({ error: 'No valid URLs provided' });

  const org = req.user.organization;
  const show = showId
    ? await prisma.show.findFirst({ where: { id: showId, organizationId: org.id } })
    : await prisma.show.findFirst({ where: { organizationId: org.id } });
  if (!show) return res.status(400).json({ error: 'No show configured for this organization' });

  // Fetch + extract each URL; collect those with enough readable text.
  const segments = [];
  const failed = [];
  for (const url of cleanUrls) {
    try {
      const { title: articleTitle, text } = await fetchPageArticle(url);
      if (text.length < MIN_ARTICLE_CHARS) {
        failed.push({ url, reason: `too little readable text (${text.length} chars)` });
        continue;
      }
      segments.push({ title: articleTitle || 'Untitled', text });
    } catch (err) {
      failed.push({ url, reason: err.message });
    }
  }

  if (!segments.length) {
    return res.status(422).json({
      error: 'Could not extract readable article text from any of those URLs.',
      failed,
    });
  }

  try {
    const episode = await generateDigestEpisode({
      org,
      show,
      voiceElevenLabsId: voiceId,
      segments,
      title: title || segments[0].title,
      description: segments.length > 1
        ? `Featuring: ${segments.map(s => s.title).join(' • ')}`.slice(0, 500)
        : undefined,
    });
    res.json({ episodeId: episode.id, audioUrl: episode.audioUrl, used: segments.length, failed });
  } catch (err) {
    if (err instanceof GenerationError) {
      if (err.code === 'character_limit_exceeded') {
        return res.status(402).json({ error: 'character_limit_exceeded' });
      }
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Generate from-urls error:', err.message);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

module.exports = router;

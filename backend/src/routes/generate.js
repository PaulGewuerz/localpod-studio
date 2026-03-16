const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  const { articleText } = req.body;
  if (!articleText) return res.status(400).json({ error: 'articleText is required' });

  // ElevenLabs call goes here
  res.json({ message: 'generate route hit', received: articleText.slice(0, 100) });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

router.post('/', express.raw({ type: 'application/pdf', limit: '20mb' }), async (req, res) => {
  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: 'No PDF provided' });
  }
  try {
    const { text } = await pdfParse(req.body);
    res.json({ text: text.trim() });
  } catch (err) {
    res.status(422).json({ error: 'Could not extract text from PDF' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { sendSMS } = require('../notify');

router.post('/', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required' });
  }

  sendSMS(`LocalPod support message from ${name} (${email}):\n${message}`)
    .catch(err => console.error('SMS alert failed:', err.message));

  res.json({ ok: true });
});

module.exports = router;

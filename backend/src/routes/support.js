const express = require('express');
const router = express.Router();
const { sendSMS } = require('../notify');

router.post('/', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required' });
  }

  try {
    await sendSMS(`LocalPod support message from ${name} (${email}):\n${message}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../prisma');
const { sendEpisodeReadyEmail } = require('../email');

// Static-key auth for unattended automation (a cron/agent that drives the
// studio via the browser and can't hold a short-lived Supabase user token).
// These routes authenticate with a shared secret in NOTIFY_API_KEY, sent as
// `Authorization: Bearer <key>`.
function requireAutomationKey(req, res, next) {
  const expected = process.env.NOTIFY_API_KEY;
  if (!expected) {
    console.error('[automation] NOTIFY_API_KEY not set — rejecting request');
    return res.status(503).json({ error: 'Automation not configured' });
  }
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid automation key' });
  }
  next();
}

// POST /automation/notify-ready  { episodeId }
// Emails the account holder(s) of the org that owns the episode that a draft
// is pending review, with a deep link to the review page. For the automation
// agent to call right after it drops a draft.
router.post('/notify-ready', requireAutomationKey, async (req, res) => {
  const { episodeId } = req.body || {};
  if (!episodeId) return res.status(400).json({ error: 'episodeId is required' });

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: { show: { include: { organization: { include: { users: true } } } } },
  });
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const users = episode.show.organization.users || [];
  if (!users.length) return res.status(404).json({ error: 'No account holder to notify' });

  const reviewUrl = `${process.env.FRONTEND_URL || 'https://app.localpod.co'}/episodes/${episode.id}/review`;
  try {
    await Promise.all(users.map(u =>
      sendEpisodeReadyEmail({ to: u.email, showName: episode.show.name, episodeTitle: episode.title, reviewUrl })
    ));
    res.json({ notified: true, to: users.map(u => u.email) });
  } catch (err) {
    console.error('[automation] notify-ready email failed:', err.message);
    res.status(500).json({ error: 'Failed to send notification email' });
  }
});

module.exports = router;

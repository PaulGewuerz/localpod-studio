const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { sendSMS } = require('../notify');
const { sendDistributionRequestConfirmation, sendDistributionRequestAdmin } = require('../email');

router.post('/submit-request', async (req, res) => {
  const { showId } = req.body;
  const orgId = req.user.organization.id;
  const userEmail = req.user.email;

  try {
    const show = showId
      ? await prisma.show.findFirst({ where: { id: showId, organizationId: orgId } })
      : await prisma.show.findFirst({ where: { organizationId: orgId } });

    const showName = show?.name ?? 'Unknown Show';
    const rssUrl = show?.megaphoneRssUrl ?? 'No RSS URL yet';

    await Promise.all([
      sendSMS(`LocalPod: Directory submission requested\nOrg: ${req.user.organization.name}\nShow: ${showName}\nRSS: ${rssUrl}\nRequested by: ${userEmail}`),
      sendDistributionRequestConfirmation({ to: userEmail, showName }),
      sendDistributionRequestAdmin({ orgName: req.user.organization.name, showName, rssUrl, userEmail }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('Distribution submit-request error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

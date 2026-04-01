const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { supabase } = require('../supabase');
// GET /admin/publishers — list all orgs
router.get('/publishers', async (req, res) => {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      megaphoneShowId: true,
      megaphoneRssUrl: true,
      defaultVoiceId: true,
      createdAt: true,
      users: { select: { id: true, email: true, name: true } },
      subscription: { select: { status: true, plan: true } },
      defaultVoice: { select: { id: true, name: true } },
      shows: { take: 1, select: { id: true } },
    },
  });
  res.json(orgs);
});

// POST /admin/publishers — create org + user + show + trial subscription + Megaphone show + send magic link
router.post('/publishers', async (req, res) => {
  const { orgName, email, defaultVoiceId } = req.body;
  if (!orgName || !email) {
    return res.status(400).json({ error: 'orgName and email are required' });
  }

  // Check for duplicate email
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'A user with that email already exists' });

  const warnings = [];

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      defaultVoiceId: defaultVoiceId || null,
      users: {
        create: { email, name: email.split('@')[0] },
      },
      shows: {
        create: { name: orgName },
      },
      subscription: {
        create: { status: 'trial' },
      },
    },
    include: {
      users: true,
      defaultVoice: { select: { id: true, name: true } },
      subscription: true,
    },
  });

  // Send magic link — fire and forget so a slow Supabase response doesn't block the HTTP reply
  supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    .then(({ error }) => { if (error) console.error('Magic link error:', error.message); })
    .catch(err => console.error('Magic link error:', err.message));

  res.status(201).json({ org, ...(warnings.length ? { warnings } : {}) });
});

// PATCH /admin/publishers/:orgId — update megaphoneShowId and/or defaultVoiceId
router.patch('/publishers/:orgId', async (req, res) => {
  const { orgId } = req.params;
  const { megaphoneShowId, defaultVoiceId, orgName, megaphoneRssUrl } = req.body;

  const data = {};
  if (orgName !== undefined)          data.name = orgName;
  if (megaphoneShowId !== undefined)  data.megaphoneShowId = megaphoneShowId || null;
  if (megaphoneRssUrl !== undefined)  data.megaphoneRssUrl = megaphoneRssUrl || null;
  if (defaultVoiceId !== undefined)   data.defaultVoiceId = defaultVoiceId || null;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const org = await prisma.organization.update({
    where: { id: orgId },
    data,
    include: {
      users: { select: { id: true, email: true, name: true } },
      subscription: { select: { status: true, plan: true } },
      defaultVoice: { select: { id: true, name: true } },
    },
  });

  res.json({ org });
});

// PATCH /admin/publishers/:orgId/directories — set directory submission statuses
router.patch('/publishers/:orgId/directories', async (req, res) => {
  const { orgId } = req.params;
  const { directories } = req.body;

  const show = await prisma.show.findFirst({ where: { organizationId: orgId } });
  if (!show) return res.status(404).json({ error: 'Show not found' });

  await prisma.show.update({
    where: { id: show.id },
    data: { directoryStatuses: directories },
  });

  res.json({ updated: true });
});

module.exports = router;

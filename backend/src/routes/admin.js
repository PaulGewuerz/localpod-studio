const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { supabase, supabaseAdmin } = require('../supabase');
// GET /admin/publishers — list all orgs with episode stats
router.get('/publishers', async (req, res) => {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      defaultVoiceId: true,
      createdAt: true,
      users: { select: { id: true, email: true, name: true } },
      subscription: { select: { status: true, plan: true } },
      defaultVoice: { select: { id: true, name: true } },
      shows: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, megaphoneShowId: true, megaphoneRssUrl: true },
      },
    },
  });

  if (orgs.length === 0) return res.json([]);

  const showIds = orgs.flatMap(o => o.shows.map(s => s.id));
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalStats, monthlyStats, latestEpisodes] = await Promise.all([
    prisma.episode.groupBy({
      by: ['showId'],
      where: { showId: { in: showIds } },
      _count: { id: true },
      _sum: { characterCount: true },
    }),
    prisma.episode.groupBy({
      by: ['showId'],
      where: { showId: { in: showIds }, createdAt: { gte: startOfMonth } },
      _sum: { characterCount: true },
    }),
    prisma.episode.findMany({
      where: { showId: { in: showIds } },
      orderBy: { createdAt: 'desc' },
      select: { showId: true, createdAt: true, status: true },
      distinct: ['showId'],
    }),
  ]);

  const totalByShow = Object.fromEntries(totalStats.map(s => [s.showId, { count: s._count.id, chars: s._sum.characterCount ?? 0 }]));
  const monthlyByShow = Object.fromEntries(monthlyStats.map(s => [s.showId, s._sum.characterCount ?? 0]));
  const lastEpByShow = Object.fromEntries(latestEpisodes.map(e => [e.showId, { at: e.createdAt, status: e.status }]));

  const result = orgs.map(org => ({
    ...org,
    shows: org.shows.map(show => ({
      ...show,
      episodeCount: totalByShow[show.id]?.count ?? 0,
      totalChars: totalByShow[show.id]?.chars ?? 0,
      monthlyChars: monthlyByShow[show.id] ?? 0,
      lastEpisodeAt: lastEpByShow[show.id]?.at ?? null,
      lastEpisodeStatus: lastEpByShow[show.id]?.status ?? null,
    })),
  }));

  res.json(result);
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

  // Send invite email so user sets their own password — fire and forget
  supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.FRONTEND_URL || 'https://app.localpod.co'}/auth/reset-password`,
  })
    .then(({ error }) => { if (error) console.error('Invite error:', error.message); })
    .catch(err => console.error('Invite error:', err.message));

  res.status(201).json({ org, ...(warnings.length ? { warnings } : {}) });
});

// PATCH /admin/publishers/:orgId — update org-level fields (name, defaultVoiceId)
router.patch('/publishers/:orgId', async (req, res) => {
  const { orgId } = req.params;
  const { defaultVoiceId, orgName } = req.body;

  const data = {};
  if (orgName !== undefined)        data.name = orgName;
  if (defaultVoiceId !== undefined) data.defaultVoiceId = defaultVoiceId || null;

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
      shows: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, megaphoneShowId: true, megaphoneRssUrl: true },
      },
    },
  });

  res.json({ org });
});

// PATCH /admin/publishers/:orgId/shows/:showId — update Megaphone fields for a specific show
router.patch('/publishers/:orgId/shows/:showId', async (req, res) => {
  const { orgId, showId } = req.params;
  const { megaphoneShowId, megaphoneRssUrl, showName } = req.body;

  const show = await prisma.show.findFirst({ where: { id: showId, organizationId: orgId } });
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const data = {};
  if (showName !== undefined)         data.name = showName;
  if (megaphoneShowId !== undefined)  data.megaphoneShowId = megaphoneShowId || null;
  if (megaphoneRssUrl !== undefined)  data.megaphoneRssUrl = megaphoneRssUrl || null;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const updated = await prisma.show.update({ where: { id: showId }, data });
  res.json({ show: updated });
});

// POST /admin/publishers/:orgId/shows — add a show to an existing org
router.post('/publishers/:orgId/shows', async (req, res) => {
  const { orgId } = req.params;
  const { showName } = req.body;
  if (!showName) return res.status(400).json({ error: 'showName is required' });

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const show = await prisma.show.create({ data: { name: showName, organizationId: orgId } });
  res.status(201).json({ show });
});

// POST /admin/publishers/:orgId/users — add a user to an existing org
router.post('/publishers/:orgId/users', async (req, res) => {
  const { orgId } = req.params;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'A user with that email already exists' });

  const user = await prisma.user.create({
    data: { email, name: email.split('@')[0], organizationId: orgId },
  });

  supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.FRONTEND_URL || 'https://app.localpod.co'}/auth/reset-password`,
  })
    .then(({ error }) => { if (error) console.error('Invite error:', error.message); })
    .catch(err => console.error('Invite error:', err.message));

  res.status(201).json({ user });
});

// DELETE /admin/publishers/:orgId — delete an org and everything under it
router.delete('/publishers/:orgId', async (req, res) => {
  const { orgId } = req.params;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { users: true, shows: true },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  // Delete episodes for all shows
  const showIds = org.shows.map(s => s.id);
  if (showIds.length) {
    await prisma.episode.deleteMany({ where: { showId: { in: showIds } } });
    await prisma.show.deleteMany({ where: { id: { in: showIds } } });
  }

  // Delete subscription
  await prisma.subscription.deleteMany({ where: { organizationId: orgId } });

  // Delete users from DB
  await prisma.user.deleteMany({ where: { organizationId: orgId } });

  // Delete org
  await prisma.organization.delete({ where: { id: orgId } });

  // Delete Supabase auth accounts for all users
  if (org.users.length) {
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    if (!error) {
      const emails = new Set(org.users.map(u => u.email));
      for (const authUser of users) {
        if (emails.has(authUser.email)) {
          await supabaseAdmin.auth.admin.deleteUser(authUser.id);
        }
      }
    }
  }

  res.json({ deleted: true });
});

// DELETE /admin/publishers/:orgId/users/:userId — remove a user from an org
router.delete('/publishers/:orgId/users/:userId', async (req, res) => {
  const { orgId, userId } = req.params;

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Delete from DB first
  await prisma.user.delete({ where: { id: userId } });

  // Delete from Supabase auth — look up by email
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  if (!error) {
    const authUser = users.find(u => u.email === user.email);
    if (authUser) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.id);
    }
  }

  res.json({ deleted: true });
});

// POST /admin/publishers/:orgId/activate — manually activate a subscription
router.post('/publishers/:orgId/activate', async (req, res) => {
  const { orgId } = req.params;

  const subscription = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
  if (!subscription) return res.status(404).json({ error: 'Subscription not found' });

  const updated = await prisma.subscription.update({
    where: { organizationId: orgId },
    data: { status: 'active' },
  });

  res.json({ subscription: updated });
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

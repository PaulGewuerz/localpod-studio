const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');
const { getHostingAdapter } = require('../adapters/hosting');

// GET /me — current publisher's org, show, subscription, voice
router.get('/', async (req, res) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.user.organization.id },
    include: {
      shows: { take: 1 },
      subscription: true,
      defaultVoice: { select: { id: true, name: true, elevenLabsId: true, description: true, previewUrl: true } },
    },
  });

  res.json({
    org: {
      id: org.id,
      name: org.name,
      megaphoneShowId: org.megaphoneShowId,
      megaphoneRssUrl: org.megaphoneRssUrl ?? null,
      defaultVoice: org.defaultVoice ?? null,
    },
    show: org.shows[0] ?? null,
    subscription: org.subscription,
  });
});

// PATCH /me — update show name, author, coverArtUrl, defaultVoiceId
router.patch('/', async (req, res) => {
  const { showName, author, description, category, categories, defaultVoiceId, coverArtUrl } = req.body;
  const orgId = req.user.organization.id;

  // Normalize: accept either `categories` (array) or legacy `category` (string)
  const categoryValue = categories !== undefined
    ? (Array.isArray(categories) ? JSON.stringify(categories) : categories)
    : category;

  const updates = [];

  if (showName !== undefined || author !== undefined || description !== undefined || categoryValue !== undefined || coverArtUrl !== undefined) {
    const show = await prisma.show.findFirst({ where: { organizationId: orgId } });
    if (show) {
      const data = {};
      if (showName !== undefined)       data.name = showName;
      if (author !== undefined)         data.author = author;
      if (description !== undefined)    data.description = description;
      if (categoryValue !== undefined)  data.category = categoryValue;
      if (coverArtUrl !== undefined)    data.coverArtUrl = coverArtUrl;
      await prisma.show.update({ where: { id: show.id }, data });
    }
    updates.push('show');
  }

  if (defaultVoiceId !== undefined) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { defaultVoiceId: defaultVoiceId || null },
    });
    updates.push('voice');
  }

  // Sync show metadata to Megaphone if relevant fields changed
  if (updates.includes('show') && (showName !== undefined || description !== undefined || coverArtUrl !== undefined)) {
    try {
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (org?.megaphoneShowId) {
        const hosting = getHostingAdapter();
        const megaphoneUpdates = {};
        if (showName !== undefined)    megaphoneUpdates.title = showName;
        if (description !== undefined) megaphoneUpdates.summary = description;

        if (Object.keys(megaphoneUpdates).length > 0) {
          await hosting.updatePodcast(org.megaphoneShowId, megaphoneUpdates);
        }

        if (coverArtUrl !== undefined) {
          await hosting.uploadPodcastCoverArt(org.megaphoneShowId, coverArtUrl);
        }
      }
    } catch (err) {
      console.error('Megaphone sync failed (non-fatal):', err.message);
    }
  }

  res.json({ updated: updates });
});

// POST /me/cover-art — upload cover art via service role (bypasses RLS)
router.post('/cover-art', express.raw({ type: ['image/jpeg', 'image/png'], limit: '10mb' }), async (req, res) => {
  const orgId = req.user.organization.id;
  const contentType = req.headers['content-type'] || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const path = `${orgId}/cover.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from('cover-art')
    .upload(path, req.body, { upsert: true, contentType });

  if (error) return res.status(500).json({ error: error.message });

  const { data: { publicUrl } } = supabaseAdmin.storage.from('cover-art').getPublicUrl(path);
  res.json({ url: publicUrl });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { supabaseAdmin } = require('../supabase');
const { getHostingAdapter } = require('../adapters/hosting');
const { detectSource, previewScrape } = require('../automation/articleSource');
const { showLimitForPlan } = require('../utils/planLimits');
const { provisionMegaphoneShow } = require('../services/provisionShow');
const { sendSMS } = require('../notify');

const VALID_SOURCE_TYPES = ['rss', 'sitemap', 'scrape'];

// Normalize per-source options to a known shape (or null).
function sanitizeSourceConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const linkSelector = typeof raw.linkSelector === 'string' ? raw.linkSelector.trim() : '';
  return linkSelector ? { linkSelector } : null;
}

// Normalize the automation ad-selection blob to a known shape (or null).
function sanitizeAdSelections(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {
    preRollCampaignId: raw.preRollCampaignId || null,
    postRollCampaignId: raw.postRollCampaignId || null,
    midRollCampaignIds: Array.isArray(raw.midRollCampaignIds)
      ? raw.midRollCampaignIds.filter(id => typeof id === 'string') : [],
  };
  if (!out.preRollCampaignId && !out.postRollCampaignId && out.midRollCampaignIds.length === 0) {
    return null;
  }
  return out;
}

// GET /me — current publisher's org, shows, subscription, voice
router.get('/', async (req, res) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.user.organization.id },
    include: {
      shows: { orderBy: { createdAt: 'asc' } },
      subscription: true,
      defaultVoice: { select: { id: true, name: true, elevenLabsId: true, description: true, previewUrl: true } },
    },
  });

  // Surface pending cancellation (cancel-at-period-end) so the UI can show a
  // "set to cancel on <date>" banner. Read live from Stripe and never let a
  // Stripe hiccup break /me.
  let subscription = org.subscription;
  if (subscription?.stripeSubscriptionId && ['trial', 'active'].includes(subscription.status)) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      subscription = {
        ...subscription,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        cancelAt: stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000).toISOString() : null,
      };
    } catch (err) {
      console.error('Stripe subscription lookup failed in /me:', err.message);
    }
  }

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      onboardedAt: req.user.onboardedAt,
    },
    org: {
      id: org.id,
      name: org.name,
      defaultVoice: org.defaultVoice ?? null,
    },
    shows: org.shows,
    subscription,
  });
});

// POST /me/onboarded — mark the product tour as completed (or skipped) for the
// current user so it doesn't replay on future visits. Idempotent.
router.post('/onboarded', async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { onboardedAt: req.user.onboardedAt ?? new Date() },
  });
  res.json({ onboardedAt: user.onboardedAt });
});

// POST /me/shows — create an additional podcast feed (show) for the org, up to
// the plan's feed limit. The Megaphone podcast is provisioned immediately so the
// feed and its RSS URL exist as soon as the show is created (a podcaster's first
// move is usually to submit the feed to Apple/Spotify — before publishing). The
// user fills in remaining details via Settings, which sync to Megaphone on PATCH.
router.post('/shows', async (req, res) => {
  const orgId = req.user.organization.id;
  const limit = showLimitForPlan(req.user.organization.subscription?.plan);

  const count = await prisma.show.count({ where: { organizationId: orgId } });
  if (count >= limit) {
    return res.status(403).json({
      error: `Your plan includes up to ${limit} podcast feed${limit === 1 ? '' : 's'}. Upgrade to add more.`,
      upgradeRequired: true,
    });
  }

  const name = typeof req.body?.name === 'string' && req.body.name.trim()
    ? req.body.name.trim().slice(0, 200)
    : 'Untitled Show';

  const show = await prisma.show.create({ data: { name, organizationId: orgId } });

  // Provision the Megaphone podcast now, not lazily at first publish, so the
  // feed exists for distribution right away. Slug collisions are handled inside
  // provisionMegaphoneShow. If it fails, keep the show (the user doesn't lose
  // their feed) but surface it: flag the response and alert the owner, so it can
  // be retried/fixed rather than silently leaving a feed with no Megaphone show.
  let provisioningFailed = false;
  try {
    const { megaphoneShowId, megaphoneRssUrl } = await provisionMegaphoneShow(show, { fallbackTitle: name });
    show.megaphoneShowId = megaphoneShowId;
    show.megaphoneRssUrl = megaphoneRssUrl;
  } catch (err) {
    provisioningFailed = true;
    console.error('Megaphone provisioning failed for new feed:', err.message);
    sendSMS(`LocalPod provisioning FAILED for new feed "${name}" (${req.user.email}): ${err.message} — needs manual Megaphone setup`)
      .catch(smsErr => console.error('Provisioning-failure SMS failed:', smsErr.message));
  }

  res.status(201).json({ show, provisioningFailed });
});

// POST /me/test-source — detect/validate an article source URL before saving.
// Returns the resolved source (type + URL) and a few sample headlines.
router.post('/test-source', async (req, res) => {
  const { url, selector } = req.body;
  if (!url?.trim()) return res.status(400).json({ ok: false, error: 'Enter a URL first.' });
  try {
    // A custom selector means the user is tuning a scrape source — preview that
    // directly; otherwise auto-detect the best source (rss → sitemap → scrape).
    const result = selector?.trim()
      ? await previewScrape(url, selector.trim())
      : await detectSource(url);
    res.json(result);
  } catch (err) {
    console.error('test-source failed:', err.message);
    res.status(500).json({ ok: false, error: 'Could not test that URL.' });
  }
});

// PATCH /me — update show name, author, coverArtUrl, defaultVoiceId
router.patch('/', async (req, res) => {
  const { showId, showName, author, description, category, categories, defaultVoiceId, coverArtUrl, adMarkerDefaults, feedUrl, sourceType, sourceConfig, automationEnabled, automationVoiceId, automationIntervalDays, automationStartAt, automationAdSelections } = req.body;
  const orgId = req.user.organization.id;

  // Normalize: accept either `categories` (array) or legacy `category` (string)
  const categoryValue = categories !== undefined
    ? (Array.isArray(categories) ? JSON.stringify(categories) : categories)
    : category;

  const updates = [];

  const showFields = [showName, author, description, categoryValue, coverArtUrl, adMarkerDefaults,
    feedUrl, sourceType, sourceConfig, automationEnabled, automationVoiceId, automationIntervalDays, automationStartAt, automationAdSelections];
  if (showFields.some(v => v !== undefined)) {
    const show = showId
      ? await prisma.show.findFirst({ where: { id: showId, organizationId: orgId } })
      : await prisma.show.findFirst({ where: { organizationId: orgId } });
    if (show) {
      const data = {};
      if (showName !== undefined)          data.name = showName;
      if (author !== undefined)            data.author = author;
      if (description !== undefined)       data.description = description;
      if (categoryValue !== undefined)     data.category = categoryValue;
      if (coverArtUrl !== undefined)       data.coverArtUrl = coverArtUrl;
      if (adMarkerDefaults !== undefined)  data.adMarkerDefaults = JSON.stringify(adMarkerDefaults);
      if (feedUrl !== undefined)           data.feedUrl = feedUrl || null;
      if (sourceType !== undefined)        data.sourceType = VALID_SOURCE_TYPES.includes(sourceType) ? sourceType : null;
      if (sourceConfig !== undefined)      data.sourceConfig = sanitizeSourceConfig(sourceConfig);
      if (automationEnabled !== undefined) data.automationEnabled = Boolean(automationEnabled);
      if (automationVoiceId !== undefined) data.automationVoiceId = automationVoiceId || null;
      if (automationIntervalDays !== undefined) {
        const n = parseInt(automationIntervalDays, 10);
        data.automationIntervalDays = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : null;
      }
      if (automationStartAt !== undefined) {
        const start = automationStartAt ? new Date(automationStartAt) : null;
        data.automationStartAt = start && !isNaN(start) ? start : null;
        // Re-sync the run clock to the (new) start so schedule edits take effect.
        data.automationNextRunAt = data.automationStartAt;
      }
      if (automationAdSelections !== undefined) {
        data.automationAdSelections = sanitizeAdSelections(automationAdSelections);
      }
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
      const show = showId
        ? await prisma.show.findFirst({ where: { id: showId, organizationId: orgId } })
        : await prisma.show.findFirst({ where: { organizationId: orgId } });
      if (show?.megaphoneShowId) {
        const hosting = getHostingAdapter();
        const megaphoneUpdates = {};
        if (showName !== undefined)    megaphoneUpdates.title = showName;
        if (description !== undefined) megaphoneUpdates.summary = description;

        if (Object.keys(megaphoneUpdates).length > 0) {
          await hosting.updatePodcast(show.megaphoneShowId, megaphoneUpdates);
        }

        if (coverArtUrl !== undefined) {
          await hosting.uploadPodcastCoverArt(show.megaphoneShowId, coverArtUrl);
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

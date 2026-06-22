const prisma = require('../prisma');
const { getHostingAdapter } = require('../adapters/hosting');

/**
 * Create a Megaphone show for a LocalPod Show and persist the resulting
 * megaphoneShowId + megaphoneRssUrl. This is what makes a show publishable and
 * gives it an RSS feed — without it, publishing fails with "Show has no
 * Megaphone show configured" and the Distribution page has no feed to submit.
 *
 * Idempotent: if the show already has a megaphoneShowId, it's returned as-is.
 * Throws if Megaphone show creation fails (callers decide whether to swallow).
 *
 * @param {object} show - Show row (needs name, description, category, author, coverArtUrl)
 * @param {{ fallbackTitle?: string }} [opts]
 * @returns {Promise<{ megaphoneShowId: string, megaphoneRssUrl: string }>}
 */
async function provisionMegaphoneShow(show, { fallbackTitle } = {}) {
  if (show.megaphoneShowId) {
    return { megaphoneShowId: show.megaphoneShowId, megaphoneRssUrl: show.megaphoneRssUrl };
  }

  const adapter = getHostingAdapter();
  const showTitle = show.name ?? fallbackTitle ?? 'Untitled Show';
  const slug = showTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const { id: megaphoneShowId, rssUrl } = await adapter.createPodcast({
    title: showTitle,
    slug,
    summary: show.description,
    category: show.category,
    author: show.author || showTitle,
    ownerName: show.author || showTitle,
    ownerEmail: 'paul@localpod.co',
  });
  console.log('Megaphone show created:', megaphoneShowId);

  if (show.coverArtUrl) {
    try {
      await adapter.uploadPodcastCoverArt(megaphoneShowId, show.coverArtUrl);
      console.log('Cover art uploaded to Megaphone');
    } catch (err) {
      console.error('Cover art upload failed:', err.message);
    }
  }

  await prisma.show.update({
    where: { id: show.id },
    data: { megaphoneShowId, megaphoneRssUrl: rssUrl },
  });

  return { megaphoneShowId, megaphoneRssUrl: rssUrl };
}

module.exports = { provisionMegaphoneShow };

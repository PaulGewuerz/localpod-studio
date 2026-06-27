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
  const baseSlug = showTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'show';

  // Megaphone slugs must be unique across the network. Two shows with the same
  // title (common — e.g. two publishers, or repeated test signups) would collide
  // and createPodcast would 422. Try the clean slug first, then fall back to a
  // slug suffixed with part of the show id (stable across retries of the same
  // show). The RSS feed URL is keyed off the Megaphone podcast id, not the slug,
  // so the suffix has no user-facing effect.
  const idSuffix = String(show.id).replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase();
  const slugCandidates = [baseSlug, `${baseSlug}-${idSuffix}`];

  let created;
  for (let i = 0; i < slugCandidates.length; i++) {
    try {
      created = await adapter.createPodcast({
        title: showTitle,
        slug: slugCandidates[i],
        summary: show.description,
        category: show.category,
        author: show.author || showTitle,
        ownerName: show.author || showTitle,
        ownerEmail: 'paul@localpod.co',
      });
      break;
    } catch (err) {
      const isSlugConflict = err.status === 422 || /slug|taken|already|exist/i.test(err.message || '');
      const hasMoreCandidates = i < slugCandidates.length - 1;
      if (isSlugConflict && hasMoreCandidates) {
        console.warn(`Megaphone slug "${slugCandidates[i]}" rejected (${err.message}); retrying with "${slugCandidates[i + 1]}"`);
        continue;
      }
      throw err;
    }
  }

  const { id: megaphoneShowId, rssUrl } = created;
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

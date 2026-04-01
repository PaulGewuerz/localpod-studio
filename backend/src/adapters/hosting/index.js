/**
 * Hosting adapter factory.
 *
 * To swap providers: set PODCAST_HOSTING_PROVIDER to the new provider name,
 * add its adapter file here, and nothing else in the codebase changes.
 *
 * All adapters must implement:
 *   publishEpisode(podcastId, { title, description, audioUrl, pubdate }) → { id, url }
 *   getEpisodes(podcastId)                                               → Array
 *   deleteEpisode(podcastId, episodeId)                                  → void
 *   updateEpisode(podcastId, episodeId, { title, description })          → void
 */

const MegaphoneAdapter = require('./megaphone');

function getHostingAdapter() {
  const provider = process.env.PODCAST_HOSTING_PROVIDER || 'megaphone';

  switch (provider) {
    case 'megaphone':
      return new MegaphoneAdapter({
        apiKey: process.env.MEGAPHONE_API_KEY,
        orgId: process.env.MEGAPHONE_ORG_ID,
        networkId: process.env.MEGAPHONE_NETWORK_ID,
      });

    // Future providers:
    // case 'transistor':
    //   return new TransistorAdapter({ apiKey: process.env.TRANSISTOR_API_KEY });
    // case 'buzzsprout':
    //   return new BuzzsproutAdapter({ apiKey: process.env.BUZZSPROUT_API_KEY });

    default:
      throw new Error(`Unknown hosting provider: ${provider}`);
  }
}

module.exports = { getHostingAdapter };

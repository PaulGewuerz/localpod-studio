/**
 * Megaphone hosting adapter
 * Endpoints are scoped to a network within an org:
 *   /organizations/{orgId}/networks/{networkId}/podcasts/{podcastId}/episodes
 */

const BASE_URL = 'https://cms.megaphone.fm/api';

class MegaphoneAdapter {
  constructor({ apiKey, orgId, networkId }) {
    this.apiKey = apiKey;
    this.orgId = orgId;
    this.networkId = networkId;
  }

  #headers() {
    return {
      'Authorization': `Token token=${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  #podcastPath(podcastId) {
    return `/networks/${this.networkId}/podcasts/${podcastId}`;
  }

  async #request(method, path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: this.#headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || data.error || `Megaphone API error ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return data;
  }

  /**
   * Create a new podcast (show) in Megaphone.
   * @param {{ title: string, slug: string, summary?: string }} podcast
   * @returns {{ id: string, rssUrl: string }}
   */
  async createPodcast({ title, slug, summary, imageUrl, category, author, ownerName, ownerEmail }) {
    const body = {
      title,
      slug,
      summary: summary || title,
      language: 'en-US',
      itunesCategories: (() => {
        if (!category) return ['News'];
        // JSON array of categories e.g. ["News > Daily News", "Business"]
        let cats;
        try { cats = JSON.parse(category); } catch { cats = [category]; }
        if (!Array.isArray(cats)) cats = [cats];
        // Build array of [parent, subcategory?] pairs — first category is primary
        return cats.flatMap(c => c.split(' > '));
      })(),
    };
    if (author)     body.author = author;
    if (ownerName)  body.ownerName = ownerName;
    if (ownerEmail) body.ownerEmail = ownerEmail;
    const data = await this.#request('POST', `/networks/${this.networkId}/podcasts`, body);
    const rssUrl = data.feedUrl || data.rssUrl || data.rss_url || `https://feeds.megaphone.fm/${data.id}`;
    return { id: data.id, rssUrl };
  }

  /**
   * Update podcast metadata (title, image, etc).
   * @param {string} podcastId
   * @param {object} updates
   */
  async updatePodcast(podcastId, updates) {
    return this.#request('PUT', `${this.#podcastPath(podcastId)}`, updates);
  }

  /**
   * Upload cover art for a podcast via Megaphone's S3 multipart upload flow.
   * Flow: initiate → presigned URL → PUT to S3 → complete → REST update with backgroundImageFileUrl
   * Note: backgroundImageFileUrl is processed asynchronously by Megaphone — the response imageFile
   * will still show the old placeholder but the image will be applied within a few seconds.
   * @param {string} podcastId
   * @param {string} imageUrl  - publicly accessible image URL
   */
  async uploadPodcastCoverArt(podcastId, imageUrl) {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
    const buffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `cover.${ext}`;

    const authHeader = { 'Authorization': `Token token=${this.apiKey}` };

    // Initiate multipart upload
    const multipartRes = await fetch('https://cms.megaphone.fm/s3/multipart', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, type: contentType, metadata: { name: filename, type: contentType } }),
    });
    if (!multipartRes.ok) throw new Error(`Multipart initiate failed: ${multipartRes.status}`);
    const { uploadId, key } = await multipartRes.json();

    // Get pre-signed URL for part 1
    const partRes = await fetch(
      `https://cms.megaphone.fm/s3/multipart/${encodeURIComponent(uploadId)}/1?key=${encodeURIComponent(key)}`,
      { headers: authHeader }
    );
    if (!partRes.ok) throw new Error(`Failed to get presigned URL: ${partRes.status}`);
    const { url: presignedUrl } = await partRes.json();

    // Upload bytes directly to S3
    const s3Res = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: buffer,
    });
    if (!s3Res.ok) throw new Error(`S3 upload failed: ${s3Res.status}`);
    const etag = s3Res.headers.get('etag');

    // Complete multipart upload
    const completeRes = await fetch(
      `https://cms.megaphone.fm/s3/multipart/${encodeURIComponent(uploadId)}/complete?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
      }
    );
    if (!completeRes.ok) throw new Error(`Multipart complete failed: ${completeRes.status}`);
    const { location } = await completeRes.json();
    const s3ImageUrl = location || `https://megaphone-uploads-temp.s3.amazonaws.com/${key}`;

    // Tell Megaphone to apply the uploaded image (processed asynchronously on their end)
    return this.#request('PUT', this.#podcastPath(podcastId), { backgroundImageFileUrl: s3ImageUrl });
  }

  /**
   * Publish a new episode to a podcast.
   * @param {string} podcastId - The Megaphone podcast ID (stored as org.megaphoneShowId)
   * @param {{ title: string, description?: string, audioUrl: string, pubdate?: string }} episode
   * @returns {{ id: string, url: string }}
   */
  async publishEpisode(podcastId, { title, description, audioUrl, pubdate }) {
    const data = await this.#request(
      'POST',
      `${this.#podcastPath(podcastId)}/episodes`,
      {
        title,
        summary: description || '',
        backgroundAudioFileUrl: audioUrl,
        pubdate: pubdate || new Date().toISOString(),
        draft: false,
      }
    );
    const playerUrl = data.uid ? `https://playlist.megaphone.fm?e=${data.uid}` : null;
    return { id: data.id, url: playerUrl };
  }

  /**
   * Fetch all episodes for a podcast (includes download counts).
   * @param {string} podcastId
   * @returns {Array}
   */
  async getEpisodes(podcastId) {
    return this.#request('GET', `${this.#podcastPath(podcastId)}/episodes`);
  }

  /**
   * Fetch podcast-level download statistics.
   * @param {string} podcastId
   * @param {{ from?: string, to?: string }} options  ISO date strings
   * @returns {object}
   */
  async getPodcastStats(podcastId, { from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    const qs = params.toString() ? `?${params}` : '';
    return this.#request('GET', `${this.#podcastPath(podcastId)}/statistics${qs}`);
  }

  /**
   * Delete an episode.
   * @param {string} podcastId
   * @param {string} episodeId
   */
  async deleteEpisode(podcastId, episodeId) {
    return this.#request('DELETE', `${this.#podcastPath(podcastId)}/episodes/${episodeId}`);
  }

  /**
   * Update episode metadata.
   * @param {string} podcastId
   * @param {string} episodeId
   * @param {{ title?: string, description?: string }} updates
   */
  async updateEpisode(podcastId, episodeId, updates) {
    return this.#request(
      'PUT',
      `${this.#podcastPath(podcastId)}/episodes/${episodeId}`,
      { title: updates.title, summary: updates.description }
    );
  }
}

module.exports = MegaphoneAdapter;

const { stitchCampaigns } = require('./stitchAudio');
const { supabaseAdmin } = require('../supabase');

/**
 * Resolves which campaigns to stitch into the episode audio, then stitches and uploads.
 *
 * Priority:
 *   1. If the episode has explicit adAssignments, use those.
 *   2. Otherwise, auto-assign from active campaigns whose type matches the show's
 *      adMarkerDefaults (pre-roll / post-roll only — mid-roll needs an explicit timestamp).
 *
 * In both cases, only campaigns that are active, have audio, and are within their
 * date window are included.
 *
 * Returns the URL to pass to Megaphone (stitched or original).
 *
 * @param {object} episode - prisma episode with adAssignments, audioUrl, show
 * @param {string} orgId
 * @param {object} prisma
 * @returns {Promise<string>}
 */
async function preparePublishAudio(episode, orgId, prisma) {
  if (!episode.audioUrl) return episode.audioUrl;

  const now = new Date();

  let assignments;

  if (episode.adAssignments) {
    // Explicit per-episode assignments
    try {
      assignments = JSON.parse(episode.adAssignments);
    } catch {
      assignments = [];
    }
  }

  if (!assignments || assignments.length === 0) {
    // Auto-assign from show defaults
    const defaults = episode.show?.adMarkerDefaults
      ? (() => { try { return JSON.parse(episode.show.adMarkerDefaults); } catch { return null; } })()
      : null;

    if (!defaults || (!defaults.preRoll && !defaults.postRoll)) return episode.audioUrl;

    const activeCampaigns = await prisma.adCampaign.findMany({
      where: {
        organizationId: orgId,
        status: 'active',
        audioUrl: { not: null },
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: now } }] },
          { OR: [{ endDate: null }, { endDate: { gte: now } }] },
        ],
      },
      select: { id: true, type: true, audioUrl: true },
    });

    assignments = [];
    for (const c of activeCampaigns) {
      if (c.type === 'pre-roll' && defaults.preRoll) {
        assignments.push({ campaignId: c.id, type: 'pre-roll' });
      } else if (c.type === 'post-roll' && defaults.postRoll) {
        assignments.push({ campaignId: c.id, type: 'post-roll' });
      }
      // mid-roll skipped in auto-mode: no timestamp to insert at
    }

    if (!assignments.length) return episode.audioUrl;
  }

  // Fetch audio URLs for assigned campaigns, enforcing active + date window
  const campaignIds = [...new Set(assignments.map(a => a.campaignId).filter(Boolean))];
  if (!campaignIds.length) return episode.audioUrl;

  const campaigns = await prisma.adCampaign.findMany({
    where: {
      id: { in: campaignIds },
      organizationId: orgId,
      status: 'active',
      audioUrl: { not: null },
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
    },
    select: { id: true, audioUrl: true },
  });

  const campaignAudioUrls = {};
  for (const c of campaigns) {
    if (c.audioUrl) campaignAudioUrls[c.id] = c.audioUrl;
  }

  if (!Object.keys(campaignAudioUrls).length) return episode.audioUrl;

  const stitchedBuffer = await stitchCampaigns(episode.audioUrl, assignments, campaignAudioUrls);
  if (!stitchedBuffer) return episode.audioUrl;

  const storagePath = `stitched/${orgId}/${episode.id}_${Date.now()}.mp3`;
  const { error } = await supabaseAdmin.storage
    .from('audio')
    .upload(storagePath, stitchedBuffer, { contentType: 'audio/mpeg', upsert: true });

  if (error) throw new Error(`Failed to upload stitched audio: ${error.message}`);

  const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath);
  return publicUrl;
}

module.exports = { preparePublishAudio };

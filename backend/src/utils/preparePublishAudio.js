const { stitchCampaigns } = require('./stitchAudio');
const { supabaseAdmin } = require('../supabase');

/**
 * Stitches explicitly assigned ad campaigns into the episode audio and uploads.
 *
 * Only acts on explicit per-episode adAssignments — no auto-assignment from show defaults.
 * Only campaigns that are active, have audio, and are within their date window are included.
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

  if (!episode.adAssignments) return episode.audioUrl;

  let assignments;
  try {
    assignments = JSON.parse(episode.adAssignments);
  } catch {
    assignments = [];
  }

  if (!assignments.length) return episode.audioUrl;

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

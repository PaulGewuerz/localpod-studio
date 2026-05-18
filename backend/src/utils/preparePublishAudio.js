const { stitchCampaigns } = require('./stitchAudio');
const { supabaseAdmin } = require('../supabase');

/**
 * If the episode has ad assignments with audio, stitches them into the episode audio
 * and uploads the result to Supabase. Returns the URL to pass to Megaphone.
 * Falls back to episode.audioUrl if no stitching is needed or possible.
 *
 * @param {object} episode - prisma episode object with adAssignments and audioUrl
 * @param {string} orgId
 * @param {object} prisma
 * @returns {Promise<string>} audio URL to publish
 */
async function preparePublishAudio(episode, orgId, prisma) {
  if (!episode.adAssignments || !episode.audioUrl) return episode.audioUrl;

  let assignments;
  try {
    assignments = JSON.parse(episode.adAssignments);
  } catch {
    return episode.audioUrl;
  }
  if (!Array.isArray(assignments) || !assignments.length) return episode.audioUrl;

  const campaignIds = [...new Set(assignments.map(a => a.campaignId).filter(Boolean))];
  if (!campaignIds.length) return episode.audioUrl;

  const campaigns = await prisma.adCampaign.findMany({
    where: { id: { in: campaignIds }, organizationId: orgId, status: 'active' },
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

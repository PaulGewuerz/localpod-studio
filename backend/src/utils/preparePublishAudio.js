const { stitchCampaigns } = require('./stitchAudio');
const { supabaseAdmin } = require('../supabase');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

/**
 * If the audio URL points to a non-MP3 file, download it, convert to MP3 via ffmpeg,
 * upload to Supabase, and return the new URL. Otherwise returns the original URL.
 */
async function ensureMp3(audioUrl, orgId, episodeId) {
  if (!audioUrl) return audioUrl;
  const isNotMp3 = !/\.mp3(\?|$)/i.test(audioUrl);
  if (!isNotMp3) return audioUrl;

  const tmp = os.tmpdir();
  const id = `lp_conv_${Date.now()}`;
  const inputPath = path.join(tmp, `${id}_input`);
  const outputPath = path.join(tmp, `${id}_output.mp3`);

  try {
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`Failed to download audio for conversion: ${res.status}`);
    await fs.writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

    await execAsync(`ffmpeg -y -i "${inputPath}" -acodec libmp3lame -ar 44100 -ab 128k -ac 2 "${outputPath}"`);

    const mp3Buffer = await fs.readFile(outputPath);
    const storagePath = `converted/${orgId}/${episodeId}_${Date.now()}.mp3`;
    const { error } = await supabaseAdmin.storage
      .from('audio')
      .upload(storagePath, mp3Buffer, { contentType: 'audio/mpeg', upsert: true });
    if (error) throw new Error(`Failed to upload converted audio: ${error.message}`);

    const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath);
    return publicUrl;
  } finally {
    await Promise.all([inputPath, outputPath].map(p => fs.unlink(p).catch(() => {})));
  }
}

/**
 * Stitches explicitly assigned ad campaigns into the episode audio and uploads.
 *
 * Only acts on explicit per-episode adAssignments — no auto-assignment from show defaults.
 * Only campaigns that are active, have audio, and are within their date window are included.
 * Non-MP3 audio (e.g. M4A) is converted to MP3 before being passed to Megaphone.
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

  if (!episode.adAssignments) return ensureMp3(episode.audioUrl, orgId, episode.id);

  let assignments;
  try {
    assignments = JSON.parse(episode.adAssignments);
  } catch {
    assignments = [];
  }

  if (!assignments.length) return ensureMp3(episode.audioUrl, orgId, episode.id);

  // Fetch audio URLs for assigned campaigns, enforcing active + date window
  const campaignIds = [...new Set(assignments.map(a => a.campaignId).filter(Boolean))];
  if (!campaignIds.length) return ensureMp3(episode.audioUrl, orgId, episode.id);

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

  if (!Object.keys(campaignAudioUrls).length) return ensureMp3(episode.audioUrl, orgId, episode.id);

  // Ensure episode audio is MP3 before stitching — ffmpeg can't stream-copy AAC into .mp3 segments
  const episodeMp3Url = await ensureMp3(episode.audioUrl, orgId, episode.id);
  const stitchedBuffer = await stitchCampaigns(episodeMp3Url, assignments, campaignAudioUrls);
  if (!stitchedBuffer) return ensureMp3(episode.audioUrl, orgId, episode.id);

  const storagePath = `stitched/${orgId}/${episode.id}_${Date.now()}.mp3`;
  const { error } = await supabaseAdmin.storage
    .from('audio')
    .upload(storagePath, stitchedBuffer, { contentType: 'audio/mpeg', upsert: true });

  if (error) throw new Error(`Failed to upload stitched audio: ${error.message}`);

  const { data: { publicUrl } } = supabaseAdmin.storage.from('audio').getPublicUrl(storagePath);
  return publicUrl;
}

module.exports = { preparePublishAudio };

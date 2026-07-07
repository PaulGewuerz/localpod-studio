const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

/**
 * Download a public URL to a local temp file.
 */
async function downloadToTemp(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download audio (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

/**
 * Cut a segment from an audio file.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} startSec  - start time in seconds
 * @param {number|null} endSec - end time in seconds, null = cut to end
 */
async function cutSegment(inputPath, outputPath, startSec, endSec = null) {
  const durationFlag = endSec != null ? `-t ${(endSec - startSec).toFixed(6)}` : '';
  await execAsync(
    `ffmpeg -y -ss ${startSec.toFixed(6)} ${durationFlag} -i "${inputPath}" -c copy "${outputPath}"`
  );
}

/**
 * Concatenate multiple audio files into one.
 * @param {string[]} inputPaths - ordered list of file paths
 * @param {string} outputPath
 */
async function concatSegments(inputPaths, outputPath) {
  const listPath = outputPath + '.list.txt';
  const listContent = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, listContent, 'utf8');
  try {
    // Re-encode to normalise sample rate, channels, and frame boundaries across segments.
    // -c copy can produce malformed output when inputs have different encodings.
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -acodec libmp3lame -ar 44100 -ab 128k -ac 2 "${outputPath}"`
    );
  } finally {
    await fs.unlink(listPath).catch(() => {});
  }
}

/**
 * Replace a time-bounded segment in a full audio file with new audio.
 * Downloads fullAudioUrl, cuts around [timeStart, timeEnd], splices in newAudioBuffer.
 *
 * @param {string} fullAudioUrl   - public URL of the current full episode audio
 * @param {Buffer} newAudioBuffer - replacement audio for the segment
 * @param {number} timeStart      - segment start in seconds
 * @param {number} timeEnd        - segment end in seconds
 * @returns {Buffer}              - the stitched full audio
 */
async function spliceSegment(fullAudioUrl, newAudioBuffer, timeStart, timeEnd) {
  const tmp = os.tmpdir();
  const id = `lp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const rawPath    = path.join(tmp, `${id}_raw`);
  const fullPath   = path.join(tmp, `${id}_full.mp3`);
  const beforePath = path.join(tmp, `${id}_before.mp3`);
  const newPath    = path.join(tmp, `${id}_new.mp3`);
  const afterPath  = path.join(tmp, `${id}_after.mp3`);
  const outPath    = path.join(tmp, `${id}_out.mp3`);

  try {
    await downloadToTemp(fullAudioUrl, rawPath);
    // Normalise to MP3 so cutSegment can stream-copy cleanly regardless of source format
    await execAsync(`ffmpeg -y -i "${rawPath}" -acodec libmp3lame -ar 44100 -ab 128k -ac 2 "${fullPath}"`);
    await fs.unlink(rawPath).catch(() => {});
    await fs.writeFile(newPath, newAudioBuffer);

    const segments = [];

    // Before segment (only if timeStart > 0)
    if (timeStart > 0.05) {
      await cutSegment(fullPath, beforePath, 0, timeStart);
      segments.push(beforePath);
    }

    segments.push(newPath);

    // After segment
    await cutSegment(fullPath, afterPath, timeEnd);
    // Check after segment is non-empty (timeEnd might be at or beyond end of file)
    const afterStat = await fs.stat(afterPath).catch(() => null);
    if (afterStat && afterStat.size > 1000) {
      segments.push(afterPath);
    }

    await concatSegments(segments, outPath);
    return await fs.readFile(outPath);
  } finally {
    await Promise.all([rawPath, fullPath, beforePath, newPath, afterPath, outPath]
      .map(p => fs.unlink(p).catch(() => {})));
  }
}

/**
 * Concatenate audio buffers into one MP3 (re-encoded for clean frame boundaries).
 * @param {Buffer[]} buffers - ordered audio buffers
 * @returns {Buffer}
 */
async function concatAudioBuffers(buffers) {
  if (buffers.length === 1) return buffers[0];

  const tmp = os.tmpdir();
  const id = `lp_cat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inPaths = buffers.map((_, i) => path.join(tmp, `${id}_${i}.mp3`));
  const outPath = path.join(tmp, `${id}_out.mp3`);

  try {
    await Promise.all(buffers.map((b, i) => fs.writeFile(inPaths[i], b)));
    await concatSegments(inPaths, outPath);
    return await fs.readFile(outPath);
  } finally {
    await Promise.all([...inPaths, outPath].map(p => fs.unlink(p).catch(() => {})));
  }
}

/**
 * Extract a time-bounded segment from a full audio file.
 *
 * @param {string} fullAudioUrl - public URL of the current full episode audio
 * @param {number} timeStart    - segment start in seconds
 * @param {number} timeEnd      - segment end in seconds
 * @returns {Buffer}            - the extracted segment as MP3
 */
async function extractSegment(fullAudioUrl, timeStart, timeEnd) {
  const tmp = os.tmpdir();
  const id = `lp_ex_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const rawPath  = path.join(tmp, `${id}_raw`);
  const fullPath = path.join(tmp, `${id}_full.mp3`);
  const outPath  = path.join(tmp, `${id}_seg.mp3`);

  try {
    await downloadToTemp(fullAudioUrl, rawPath);
    // Normalise to MP3 so cutSegment can stream-copy cleanly regardless of source format
    await execAsync(`ffmpeg -y -i "${rawPath}" -acodec libmp3lame -ar 44100 -ab 128k -ac 2 "${fullPath}"`);
    await cutSegment(fullPath, outPath, timeStart, timeEnd);
    return await fs.readFile(outPath);
  } finally {
    await Promise.all([rawPath, fullPath, outPath].map(p => fs.unlink(p).catch(() => {})));
  }
}

/**
 * Stitch publisher ad campaigns into episode audio.
 * Pre-rolls are prepended, post-rolls are appended, mid-rolls are inserted at insertAt seconds.
 *
 * @param {string} episodeAudioUrl - public URL of the episode audio
 * @param {Array<{campaignId: string, type: string, insertAt?: number}>} assignments
 * @param {Object<string, string>} campaignAudioUrls - map of campaignId → audioUrl
 * @returns {Buffer|null} stitched audio buffer, or null if nothing to stitch
 */
async function stitchCampaigns(episodeAudioUrl, assignments, campaignAudioUrls) {
  const active = assignments.filter(a => campaignAudioUrls[a.campaignId]);
  if (!active.length) return null;

  const tmp = os.tmpdir();
  const uid = `lp_ad_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempFiles = [];

  try {
    const episodePath = path.join(tmp, `${uid}_ep.mp3`);
    await downloadToTemp(episodeAudioUrl, episodePath);
    tempFiles.push(episodePath);

    // Download each unique campaign audio
    const campPaths = {};
    for (const [campId, audioUrl] of Object.entries(campaignAudioUrls)) {
      const p = path.join(tmp, `${uid}_c_${campId}.mp3`);
      await downloadToTemp(audioUrl, p);
      campPaths[campId] = p;
      tempFiles.push(p);
    }

    const preRolls  = active.filter(a => a.type === 'pre-roll');
    const midRolls  = active.filter(a => a.type === 'mid-roll').sort((a, b) => (a.insertAt || 0) - (b.insertAt || 0));
    const postRolls = active.filter(a => a.type === 'post-roll');

    const segments = [];
    let segIdx = 0;

    for (const pr of preRolls) segments.push(campPaths[pr.campaignId]);

    if (midRolls.length === 0) {
      segments.push(episodePath);
    } else {
      let prevTime = 0;
      for (const mr of midRolls) {
        const insertAt = mr.insertAt || 0;
        if (insertAt > prevTime + 0.05) {
          const segPath = path.join(tmp, `${uid}_seg${segIdx++}.mp3`);
          await cutSegment(episodePath, segPath, prevTime, insertAt);
          tempFiles.push(segPath);
          segments.push(segPath);
        }
        segments.push(campPaths[mr.campaignId]);
        prevTime = insertAt;
      }
      // Remaining episode after last mid-roll
      const remainPath = path.join(tmp, `${uid}_remain.mp3`);
      await cutSegment(episodePath, remainPath, prevTime);
      const stat = await fs.stat(remainPath).catch(() => null);
      if (stat && stat.size > 1000) {
        tempFiles.push(remainPath);
        segments.push(remainPath);
      }
    }

    for (const po of postRolls) segments.push(campPaths[po.campaignId]);

    // If the only segment is the unmodified episode, skip
    if (segments.length === 1 && segments[0] === episodePath) return null;

    const outPath = path.join(tmp, `${uid}_out.mp3`);
    tempFiles.push(outPath);
    await concatSegments(segments, outPath);
    return await fs.readFile(outPath);
  } finally {
    await Promise.all(tempFiles.map(p => fs.unlink(p).catch(() => {})));
  }
}

module.exports = { spliceSegment, extractSegment, stitchCampaigns, concatAudioBuffers };

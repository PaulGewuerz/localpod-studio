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
    await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`);
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

  const fullPath   = path.join(tmp, `${id}_full.mp3`);
  const beforePath = path.join(tmp, `${id}_before.mp3`);
  const newPath    = path.join(tmp, `${id}_new.mp3`);
  const afterPath  = path.join(tmp, `${id}_after.mp3`);
  const outPath    = path.join(tmp, `${id}_out.mp3`);

  try {
    await downloadToTemp(fullAudioUrl, fullPath);
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
    await Promise.all([fullPath, beforePath, newPath, afterPath, outPath]
      .map(p => fs.unlink(p).catch(() => {})));
  }
}

module.exports = { spliceSegment };

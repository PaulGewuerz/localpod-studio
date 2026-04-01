const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const prisma = require('../prisma');
const { supabaseAdmin } = require('../supabase');

const AUDIO_BUCKET = 'audio';
const ACCEPTED_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/ogg', 'audio/aac'];

router.post(
  '/',
  express.raw({ type: ACCEPTED_TYPES, limit: '200mb' }),
  async (req, res) => {
    const contentType = req.headers['content-type'] || 'audio/mpeg';
    if (!ACCEPTED_TYPES.some(t => contentType.startsWith(t.split('/')[0] + '/'))) {
      return res.status(400).json({ error: 'Unsupported audio format. Use MP3, M4A, WAV, or AAC.' });
    }

    const { title, description } = req.query;
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    const org = req.user.organization;
    const episodeId = uuidv4();

    const ext = contentType.includes('mpeg') ? 'mp3'
      : contentType.includes('mp4') || contentType.includes('m4a') ? 'm4a'
      : contentType.includes('wav') ? 'wav'
      : contentType.includes('aac') ? 'aac'
      : 'mp3';

    const storagePath = `${org.id}/${episodeId}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .upload(storagePath, req.body, { contentType });

    if (uploadError) {
      console.error('Storage upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to store audio' });
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .getPublicUrl(storagePath);

    const show = await prisma.show.findFirst({ where: { organizationId: org.id } });
    if (!show) {
      return res.status(400).json({ error: 'No show configured for this organization' });
    }

    const episode = await prisma.episode.create({
      data: {
        id: episodeId,
        title: title || 'Untitled Episode',
        description: description || null,
        audioUrl: publicUrl,
        status: 'draft',
        showId: show.id,
      },
    });

    res.json({ episodeId: episode.id, audioUrl: publicUrl });
  }
);

module.exports = router;

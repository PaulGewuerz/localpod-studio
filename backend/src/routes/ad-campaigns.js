const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

const VALID_TYPES = ['pre-roll', 'mid-roll', 'post-roll'];
const VALID_STATUSES = ['active', 'paused'];

// GET /ad-campaigns
router.get('/', async (req, res) => {
  const orgId = req.user.organization.id;
  const campaigns = await prisma.adCampaign.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(campaigns);
});

// POST /ad-campaigns
router.post('/', async (req, res) => {
  const orgId = req.user.organization.id;
  const { name, audioUrl, type, status, startDate, endDate, notes } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });

  const campaign = await prisma.adCampaign.create({
    data: {
      name: name.trim(),
      audioUrl: audioUrl || null,
      type,
      status: VALID_STATUSES.includes(status) ? status : 'active',
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes: notes || null,
      organizationId: orgId,
    },
  });
  res.json(campaign);
});

// PATCH /ad-campaigns/:id
router.patch('/:id', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;

  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.organizationId !== orgId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const { name, audioUrl, type, status, startDate, endDate, notes } = req.body;
  const data = {};
  if (name !== undefined)      data.name = name.trim();
  if (audioUrl !== undefined)  data.audioUrl = audioUrl || null;
  if (type !== undefined && VALID_TYPES.includes(type)) data.type = type;
  if (status !== undefined && VALID_STATUSES.includes(status)) data.status = status;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined)   data.endDate = endDate ? new Date(endDate) : null;
  if (notes !== undefined)     data.notes = notes || null;

  const updated = await prisma.adCampaign.update({ where: { id }, data });
  res.json(updated);
});

// DELETE /ad-campaigns/:id
router.delete('/:id', async (req, res) => {
  const orgId = req.user.organization.id;
  const { id } = req.params;

  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.organizationId !== orgId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  await prisma.adCampaign.delete({ where: { id } });
  res.json({ deleted: true });
});

module.exports = router;

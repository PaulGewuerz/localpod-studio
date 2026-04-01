const router = require('express').Router();
const prisma = require('../prisma');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');

router.use(requireActiveSubscription);

const orgId = req => req.user.organization.id;

// GET all rules for the org
router.get('/', async (req, res) => {
  const rules = await prisma.pronunciationRule.findMany({
    where: { organizationId: orgId(req) },
    orderBy: { word: 'asc' },
  });
  res.json(rules);
});

// POST — create or update a rule
router.post('/', async (req, res) => {
  const { word, pronunciation } = req.body;
  if (!word || !pronunciation) {
    return res.status(400).json({ error: 'word and pronunciation are required' });
  }

  const rule = await prisma.pronunciationRule.upsert({
    where: { organizationId_word: { organizationId: orgId(req), word: word.trim() } },
    update: { pronunciation: pronunciation.trim() },
    create: { organizationId: orgId(req), word: word.trim(), pronunciation: pronunciation.trim() },
  });
  res.json(rule);
});

// DELETE a rule by id
router.delete('/:id', async (req, res) => {
  const rule = await prisma.pronunciationRule.findUnique({ where: { id: req.params.id } });
  if (!rule || rule.organizationId !== orgId(req)) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  await prisma.pronunciationRule.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
});

module.exports = router;

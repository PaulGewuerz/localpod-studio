const express = require('express')
const router = express.Router()
const prisma = require('../prisma')
const { supabase } = require('../supabase')

// POST /auth/register — create backend account for a newly signed-up Supabase user.
// Called by onboarding when /me returns 403 (authenticated in Supabase but no DB record yet).
router.post('/register', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }

  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Idempotent — return existing account if already registered
  const existing = await prisma.user.findUnique({
    where: { email: user.email },
    include: { organization: { include: { subscription: true, shows: { take: 1 } } } },
  })
  if (existing) {
    return res.json({ org: existing.organization })
  }

  const displayName = user.user_metadata?.full_name || user.email.split('@')[0]
  const orgName = displayName

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      users: {
        create: { email: user.email, name: displayName },
      },
      shows: {
        create: { name: orgName },
      },
      subscription: {
        create: { status: 'trial' },
      },
    },
    include: { subscription: true, shows: { take: 1 } },
  })

  res.status(201).json({ org })
})

module.exports = router

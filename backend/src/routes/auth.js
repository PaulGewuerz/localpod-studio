const express = require('express')
const router = express.Router()
const { supabase } = require('../supabase')

router.post('/magic-link', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'email is required' })

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
    }
  })

  if (error) return res.status(500).json({ error: error.message })

  res.json({ message: 'Magic link sent' })
})

router.post('/verify', async (req, res) => {
  const { token, email } = req.body
  if (!token || !email) return res.status(400).json({ error: 'token and email are required' })

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email'
  })

  if (error) return res.status(401).json({ error: error.message })

  res.json({ session: data.session, user: data.user })
})

module.exports = router
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Only usable in non-production environments
router.get('/', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const email = process.env.ADMIN_EMAIL;
  if (!email) return res.status(500).json({ error: 'ADMIN_EMAIL not set' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
    },
  });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ url: data.properties.action_link });
});

module.exports = router;

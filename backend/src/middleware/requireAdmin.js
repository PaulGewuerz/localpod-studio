const { supabase } = require('../supabase');
const prisma = require('../prisma');

module.exports = async function requireAdmin(req, res, next) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return res.status(500).json({ error: 'ADMIN_EMAIL not configured' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (user.email !== adminEmail) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.adminEmail = user.email;
  next();
};

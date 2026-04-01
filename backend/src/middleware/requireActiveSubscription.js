const { supabase } = require('../supabase');
const prisma = require('../prisma');

const ALLOWED_STATUSES = ['active', 'trial'];

module.exports = async function requireActiveSubscription(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const dbUser = await prisma.user.findUnique({
    where: { email: user.email },
    include: { organization: { include: { subscription: true } } },
  });

  if (!dbUser) {
    return res.status(403).json({ error: 'User not found' });
  }

  const status = dbUser.organization?.subscription?.status;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return res.status(403).json({ error: 'Active subscription required', subscriptionStatus: status ?? 'none' });
  }

  req.user = dbUser;
  next();
};

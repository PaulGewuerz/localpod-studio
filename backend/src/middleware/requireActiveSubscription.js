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

  const subscription = dbUser.organization?.subscription;
  const status = subscription?.status;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return res.status(403).json({ error: 'Active subscription required', subscriptionStatus: status ?? 'none' });
  }

  // Local expiry only applies to card-less trials. Stripe-backed trials are
  // charged at trial end and flipped to active/payment_failed by webhooks.
  if (status === 'trial' && !subscription.stripeSubscriptionId && subscription.trialEndsAt && new Date() > subscription.trialEndsAt) {
    return res.status(403).json({ error: 'Trial expired', subscriptionStatus: 'trial_expired' });
  }

  req.user = dbUser;
  next();
};

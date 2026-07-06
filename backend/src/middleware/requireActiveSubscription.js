const resolveAuthUser = require('../utils/resolveAuthUser');

const ALLOWED_STATUSES = ['active', 'trial'];

module.exports = async function requireActiveSubscription(req, res, next) {
  const result = await resolveAuthUser(req);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  const dbUser = result.dbUser;

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
  if (result.impersonatedBy) req.impersonatedBy = result.impersonatedBy;
  next();
};

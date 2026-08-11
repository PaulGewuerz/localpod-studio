// Blocks the entry-level plans (Starter, Solo) from a route — used to gate
// Publisher-only features (e.g. Ad Manager). Every other plan is allowed, so
// higher tiers that include the feature work without changing this middleware.
//
// Must run AFTER requireActiveSubscription, which populates req.user with the
// organization + subscription.
const AD_MANAGER_BLOCKED_PLANS = ['starter', 'solo'];

module.exports = function blockSoloPlan(req, res, next) {
  const plan = req.user?.organization?.subscription?.plan;
  if (AD_MANAGER_BLOCKED_PLANS.includes(plan)) {
    return res.status(403).json({
      error: 'Ad Manager is available on the Publisher plan. Upgrade to access it.',
      upgradeRequired: true,
    });
  }
  next();
};

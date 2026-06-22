// Blocks the Solo plan from a route — used to gate Publisher-only features
// (e.g. Ad Manager). Only 'solo' is rejected; every other plan is allowed, so
// future tiers that include the feature work without changing this middleware.
//
// Must run AFTER requireActiveSubscription, which populates req.user with the
// organization + subscription.
module.exports = function blockSoloPlan(req, res, next) {
  const plan = req.user?.organization?.subscription?.plan;
  if (plan === 'solo') {
    return res.status(403).json({
      error: 'Ad Manager is available on the Publisher plan. Upgrade to access it.',
      upgradeRequired: true,
    });
  }
  next();
};

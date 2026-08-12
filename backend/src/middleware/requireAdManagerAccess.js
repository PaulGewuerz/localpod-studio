// Gates the Ad Manager to plans that get at least one ad campaign. Currently
// only Starter is blocked (0 campaigns); Solo (capped at 2) and Publisher
// (unlimited) pass through. The per-plan campaign cap itself is enforced at
// create time in routes/ad-campaigns.js — this middleware only blocks plans
// with zero access.
//
// Must run AFTER requireActiveSubscription, which populates req.user with the
// organization + subscription.
const { adCampaignLimitForPlan } = require('../utils/planLimits');

module.exports = function requireAdManagerAccess(req, res, next) {
  const plan = req.user?.organization?.subscription?.plan;
  if (adCampaignLimitForPlan(plan) <= 0) {
    return res.status(403).json({
      error: 'Ad Manager is available on the Solo and Publisher plans. Upgrade to access it.',
      upgradeRequired: true,
    });
  }
  next();
};

// Monthly TTS character allowance per plan. Single source of truth for both
// the generation guard (services/generateEpisode.js) and the usage endpoint
// (routes/episodes.js).
//
// Unknown / null / legacy plans intentionally fall back to the PUBLISHER cap so
// that grandfathered accounts created before per-plan caps existed (plan = null)
// are never retroactively downgraded. Only the explicit lower tiers ('starter',
// 'solo') get a smaller cap.
const PLAN_CHARACTER_LIMITS = {
  starter: 25_000,
  solo: 50_000,
  publisher: 150_000,
};

const DEFAULT_CHARACTER_LIMIT = 150_000;

function characterLimitForPlan(plan) {
  return PLAN_CHARACTER_LIMITS[plan] ?? DEFAULT_CHARACTER_LIMIT;
}

// Per-plan cap on podcast feeds (shows). Same fail-open convention as the
// character limits above: unknown/null/legacy plans get the Publisher allowance
// so grandfathered accounts (plan = null) aren't capped at 1; only the explicit
// lower tiers ('starter', 'solo') get the lower limit. NOTE: a Publisher mislabeled as 'solo' in the DB
// would be wrongly capped at 1 — Subscription.plan is known to be unreliable, but
// it can't be re-resolved per-request (live Stripe price is prod-only).
const PLAN_SHOW_LIMITS = {
  starter: 1,
  solo: 1,
  publisher: 3,
};

const DEFAULT_SHOW_LIMIT = 3;

function showLimitForPlan(plan) {
  return PLAN_SHOW_LIMITS[plan] ?? DEFAULT_SHOW_LIMIT;
}

// Per-plan cap on ad campaigns. Ad Manager is entry-gated: Starter gets 0 (no
// access at all — enforced by middleware/requireAdManagerAccess.js), Solo is
// capped at 2, and everything else (Publisher + unknown/null/legacy) is
// unlimited. Same fail-open convention: a plan we don't recognize is never
// restricted. Enforced at create time in routes/ad-campaigns.js.
const PLAN_AD_CAMPAIGN_LIMITS = {
  starter: 0,
  solo: 2,
};

const DEFAULT_AD_CAMPAIGN_LIMIT = Infinity;

function adCampaignLimitForPlan(plan) {
  return PLAN_AD_CAMPAIGN_LIMITS[plan] ?? DEFAULT_AD_CAMPAIGN_LIMIT;
}

module.exports = {
  PLAN_CHARACTER_LIMITS,
  DEFAULT_CHARACTER_LIMIT,
  characterLimitForPlan,
  PLAN_SHOW_LIMITS,
  DEFAULT_SHOW_LIMIT,
  showLimitForPlan,
  PLAN_AD_CAMPAIGN_LIMITS,
  DEFAULT_AD_CAMPAIGN_LIMIT,
  adCampaignLimitForPlan,
};

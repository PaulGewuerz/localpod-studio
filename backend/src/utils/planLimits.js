// Monthly TTS character allowance per plan. Single source of truth for both
// the generation guard (services/generateEpisode.js) and the usage endpoint
// (routes/episodes.js).
//
// Unknown / null / legacy plans intentionally fall back to the PUBLISHER cap so
// that grandfathered accounts created before per-plan caps existed (plan = null)
// are never retroactively downgraded. Only an explicit 'solo' plan gets the
// lower cap.
const PLAN_CHARACTER_LIMITS = {
  solo: 50_000,
  publisher: 150_000,
};

const DEFAULT_CHARACTER_LIMIT = 150_000;

function characterLimitForPlan(plan) {
  return PLAN_CHARACTER_LIMITS[plan] ?? DEFAULT_CHARACTER_LIMIT;
}

// Per-plan cap on podcast feeds (shows). Same fail-open convention as the
// character limits above: unknown/null/legacy plans get the Publisher allowance
// so grandfathered accounts (plan = null) aren't capped at 1; only an explicit
// 'solo' gets the lower limit. NOTE: a Publisher mislabeled as 'solo' in the DB
// would be wrongly capped at 1 — Subscription.plan is known to be unreliable, but
// it can't be re-resolved per-request (live Stripe price is prod-only).
const PLAN_SHOW_LIMITS = {
  solo: 1,
  publisher: 3,
};

const DEFAULT_SHOW_LIMIT = 3;

function showLimitForPlan(plan) {
  return PLAN_SHOW_LIMITS[plan] ?? DEFAULT_SHOW_LIMIT;
}

module.exports = {
  PLAN_CHARACTER_LIMITS,
  DEFAULT_CHARACTER_LIMIT,
  characterLimitForPlan,
  PLAN_SHOW_LIMITS,
  DEFAULT_SHOW_LIMIT,
  showLimitForPlan,
};

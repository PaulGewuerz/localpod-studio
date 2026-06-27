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

module.exports = { PLAN_CHARACTER_LIMITS, DEFAULT_CHARACTER_LIMIT, characterLimitForPlan };

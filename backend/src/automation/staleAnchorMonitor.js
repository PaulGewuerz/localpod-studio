const prisma = require('../prisma');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendStaleAnchorAdminEmail } = require('../email');
const { sendSMS } = require('../notify');

// How often to run the check, and how long after boot the first run fires.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;  // daily
const INITIAL_DELAY_MS = 10 * 60 * 1000;        // 10 min after boot (survives quick redeploys)

// A healthy monthly subscription has its currentPeriodStart bumped by a paid
// invoice webhook roughly every 30 days. Past this threshold the anchor has
// effectively frozen — one full cycle plus a ~5-day grace for invoice timing.
const STALE_DAYS = 35;
// A brand-new paid sub whose first invoice webhook simply hasn't landed yet
// shouldn't alarm us; give a null anchor this long before it counts as stale.
const NULL_GRACE_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ask Stripe whether this subscription actually bills real money. A 100%-off
 * comp (or a $0-priced plan) never produces a paid invoice, so the
 * invoice.payment_succeeded webhook — guarded on `amount_paid > 0` — never sets
 * currentPeriodStart. That leaves the anchor null forever *by design*, not
 * because a webhook was dropped, so these subs shouldn't alert.
 *
 * We look at the most recent invoice: `amount_paid > 0` means money actually
 * changed hands, so a frozen anchor there is a genuine missed-webhook signal
 * worth surfacing. On any Stripe error (or if the sub has no invoice yet) we
 * fail safe and treat it as real — better a noisy alert than a silently hidden
 * billing problem.
 */
async function isComped(stripeSubscriptionId) {
  try {
    const invoices = await stripe.invoices.list({ subscription: stripeSubscriptionId, limit: 1 });
    const latest = invoices.data[0];
    if (!latest) return false;        // no invoice yet — don't assume comp
    return latest.amount_paid === 0;  // fully discounted / $0 → benign comp
  } catch (err) {
    console.error(`[stale-anchor-monitor] Stripe check failed for ${stripeSubscriptionId}: ${err.message}`);
    return false;                     // fail safe: keep it in the alert
  }
}

/**
 * Find active, Stripe-backed subscriptions whose billing anchor has stopped
 * advancing. Two cases: a non-null anchor older than STALE_DAYS (it advanced
 * before and then froze), or a null anchor on a sub created more than
 * NULL_GRACE_DAYS ago (a paying sub that never got a single invoice webhook).
 * Only subscriptions with a real stripeSubscriptionId are considered, so
 * trial/manual rows without Stripe billing never show up.
 */
async function findStaleAnchors(now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const nullGraceBefore = new Date(now.getTime() - NULL_GRACE_DAYS * DAY_MS);

  const subs = await prisma.subscription.findMany({
    where: {
      status: 'active',
      stripeSubscriptionId: { not: null },
      OR: [
        { currentPeriodStart: { lt: staleBefore } },
        { currentPeriodStart: null, createdAt: { lt: nullGraceBefore } },
      ],
    },
    include: { organization: { include: { users: { select: { email: true }, take: 1 } } } },
  });

  const rows = [];
  for (const s of subs) {
    // Skip fully-comped / 100%-off subs: their anchor is null by design, not
    // because a webhook was dropped, so alerting on them is pure noise.
    if (await isComped(s.stripeSubscriptionId)) continue;

    const email = s.organization.users[0]?.email ?? 'unknown';
    const staleDesc = s.currentPeriodStart
      ? `${Math.floor((now - s.currentPeriodStart) / DAY_MS)}d stale (since ${s.currentPeriodStart.toISOString().slice(0, 10)})`
      : `never set (sub created ${s.createdAt.toISOString().slice(0, 10)})`;
    rows.push({ orgName: s.organization.name, userEmail: email, plan: s.plan, staleDesc });
  }
  return rows;
}

async function checkStaleAnchors() {
  try {
    const rows = await findStaleAnchors(new Date());
    if (rows.length === 0) {
      console.log('[stale-anchor-monitor] no stale anchors');
      return;
    }
    console.log(`[stale-anchor-monitor] ${rows.length} stale anchor(s):`,
      rows.map(r => `${r.orgName} (${r.userEmail}) — ${r.staleDesc}`).join('; '));

    await sendStaleAnchorAdminEmail({ rows, thresholdDays: STALE_DAYS })
      .catch(err => console.error('[stale-anchor-monitor] admin email failed:', err.message));

    const summary = rows.slice(0, 5).map(r => `${r.orgName} (${r.userEmail})`).join(', ');
    const more = rows.length > 5 ? ` +${rows.length - 5} more` : '';
    await sendSMS(`LocalPod: ${rows.length} subscription(s) with stale billing anchor — possible missing invoice webhooks: ${summary}${more}`)
      .catch(err => console.error('[stale-anchor-monitor] SMS failed:', err.message));
  } catch (err) {
    console.error('[stale-anchor-monitor] check failed:', err.message);
  }
}

function startStaleAnchorMonitor() {
  const enabled = process.env.NODE_ENV === 'production' || process.env.ENABLE_STALE_MONITOR === 'true';
  if (!enabled) {
    console.log('[stale-anchor-monitor] disabled outside production (set ENABLE_STALE_MONITOR=true to run locally)');
    return;
  }
  setTimeout(checkStaleAnchors, INITIAL_DELAY_MS);
  setInterval(checkStaleAnchors, CHECK_INTERVAL_MS);
  console.log('[stale-anchor-monitor] started — checking daily');
}

module.exports = { startStaleAnchorMonitor, checkStaleAnchors, findStaleAnchors, STALE_DAYS };

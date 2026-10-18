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
 * Confirm a DB-flagged sub against Stripe before alerting. currentPeriodStart
 * is only ever advanced by an invoice.payment_succeeded webhook, so the real
 * question is: does Stripe have a *paid* invoice whose period is newer than the
 * anchor we stored? If so, we dropped or mishandled that webhook — a genuine
 * plumbing failure — and we return the correct period so the alert is
 * actionable and backfillable.
 *
 * If Stripe shows no paid invoice at all (a real trial, a free/$0 price, or a
 * partial- or 100%-off promo period that hasn't produced a paid invoice yet),
 * a null/old anchor is expected rather than dropped, so we stay quiet. On any
 * Stripe error we fail safe and alert. Note this makes no assumption about the
 * discount — only about whether money Stripe collected went unrecorded.
 */
async function stripeAnchorCheck(sub) {
  try {
    const invoices = await stripe.invoices.list({ subscription: sub.stripeSubscriptionId, limit: 5 });
    const paid = invoices.data.find((inv) => inv.amount_paid > 0 && inv.period_start);
    if (!paid) return { alert: false };  // no payment collected yet — anchor legitimately unset
    const stripeStart = new Date(paid.period_start * 1000);
    const ours = sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : null;
    if (ours && ours >= stripeStart) return { alert: false };  // anchor already current
    return { alert: true, stripeStart };  // we're behind Stripe → missed payment webhook
  } catch (err) {
    console.error(`[stale-anchor-monitor] Stripe check failed for ${sub.stripeSubscriptionId}: ${err.message}`);
    return { alert: true };  // fail safe: surface it rather than hide a real problem
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
    // The DB pre-filter only says "our anchor looks stale". Confirm against
    // Stripe and alert only when a payment we failed to record exists.
    const check = await stripeAnchorCheck(s);
    if (!check.alert) continue;

    const email = s.organization.users[0]?.email ?? 'unknown';
    const paidSince = check.stripeStart
      ? ` — Stripe shows paid period since ${check.stripeStart.toISOString().slice(0, 10)}`
      : '';
    const staleDesc = (s.currentPeriodStart
      ? `${Math.floor((now - s.currentPeriodStart) / DAY_MS)}d stale (since ${s.currentPeriodStart.toISOString().slice(0, 10)})`
      : `never set (sub created ${s.createdAt.toISOString().slice(0, 10)})`) + paidSince;
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

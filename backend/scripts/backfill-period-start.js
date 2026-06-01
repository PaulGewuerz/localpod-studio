/**
 * Backfill currentPeriodStart for existing subscribers by fetching
 * current_period_start from the Stripe API.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../src/prisma');

async function main() {
  const subs = await prisma.subscription.findMany({
    where: {
      stripeSubscriptionId: { not: null },
      currentPeriodStart: null,
    },
  });

  console.log(`Found ${subs.length} subscription(s) to backfill`);

  for (const sub of subs) {
    try {
      const invoices = await stripe.invoices.list({ subscription: sub.stripeSubscriptionId, limit: 1 });
      const latestInvoice = invoices.data[0];
      if (!latestInvoice?.period_start) throw new Error('Could not find period_start on latest invoice');
      const periodStart = new Date(latestInvoice.period_start * 1000);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodStart: periodStart },
      });
      console.log(`  Updated org ${sub.organizationId} → period start ${periodStart.toISOString()}`);
    } catch (err) {
      console.error(`  Failed for org ${sub.organizationId}: ${err.message}`);
    }
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());

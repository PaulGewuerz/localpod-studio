const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../prisma');
const { sendWelcomeEmail, sendTrialEndingEmail, sendCancellationEmail, sendCancellationAdminEmail } = require('../email');
const { sendSMS } = require('../notify');
const { getHostingAdapter } = require('../adapters/hosting');

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const obj = event.data.object;

  try {
    switch (event.type) {
      // Fired when checkout completes — store customer/subscription IDs so
      // later events can look up the org by stripeCustomerId.
      case 'checkout.session.completed': {
        if (obj.mode === 'subscription' && obj.customer_email) {
          const user = await prisma.user.findFirst({
            where: { email: obj.customer_email },
            include: { organization: { include: { subscription: true } } },
          });
          if (user?.organization?.subscription) {
            const plan = obj.metadata?.plan ?? 'publisher';
            const stripeSub = obj.subscription ? await stripe.subscriptions.retrieve(obj.subscription) : null;
            const isTrialing = stripeSub?.status === 'trialing';
            await prisma.subscription.update({
              where: { organizationId: user.organization.id },
              data: {
                stripeCustomerId: obj.customer,
                stripeSubscriptionId: obj.subscription,
                status: isTrialing ? 'trial' : 'active',
                trialEndsAt: isTrialing && stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
                plan,
              },
            });

            const show = await prisma.show.findFirst({
              where: { organizationId: user.organization.id },
            });

            // Create Megaphone podcast if not already created for this show
            if (show && !show.megaphoneShowId) {
              try {
                const adapter = getHostingAdapter();
                const showTitle = show.name ?? user.organization.name;
                const slug = showTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const coverArtUrl = show.coverArtUrl ?? null;
                const { id: megaphoneShowId, rssUrl } = await adapter.createPodcast({
                  title: showTitle,
                  slug,
                  summary: show.description,
                  category: show.category,
                  author: show.author || showTitle,
                  ownerName: show.author || showTitle,
                  ownerEmail: 'paul@localpod.co',
                });
                console.log('Megaphone show created:', megaphoneShowId);

                if (coverArtUrl) {
                  try {
                    await adapter.uploadPodcastCoverArt(megaphoneShowId, coverArtUrl);
                    console.log('Cover art uploaded to Megaphone');
                  } catch (err) {
                    console.error('Cover art upload failed:', err.message);
                  }
                }

                await prisma.show.update({
                  where: { id: show.id },
                  data: { megaphoneShowId, megaphoneRssUrl: rssUrl },
                });
              } catch (err) {
                console.error('Megaphone show creation failed:', err.message);
              }
            }

            // Send welcome email
            sendWelcomeEmail({
              to: obj.customer_email,
              showName: show?.name ?? user.organization.name,
            }).catch(err => console.error('Welcome email failed:', err.message));

            // Alert owner
            sendSMS(`New LocalPod ${isTrialing ? 'trial (card on file)' : 'subscriber'}: ${obj.customer_email} (${show?.name ?? user.organization.name})`)
              .catch(err => console.error('SMS alert failed:', err.message));
          }
        }
        break;
      }

      case 'customer.subscription.created': {
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { status: obj.status === 'trialing' ? 'trial' : 'active' },
        });
        break;
      }

      // Fired by Stripe 3 days before a trial ends — send the pre-charge
      // reminder (required by card network rules to avoid disputes).
      case 'customer.subscription.trial_will_end': {
        const sub = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: obj.id },
          include: { organization: { include: { users: true, shows: { take: 1 } } } },
        });
        if (sub?.organization && obj.trial_end) {
          const price = obj.items?.data?.[0]?.price;
          for (const orgUser of sub.organization.users) {
            sendTrialEndingEmail({
              to: orgUser.email,
              showName: sub.organization.shows[0]?.name ?? sub.organization.name,
              plan: sub.plan ?? 'publisher',
              amount: price?.unit_amount != null ? price.unit_amount / 100 : null,
              interval: price?.recurring?.interval ?? 'month',
              chargeDate: new Date(obj.trial_end * 1000),
            }).catch(err => console.error('Trial reminder email failed:', err.message));
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { status: 'inactive' },
        });
        break;
      }

      case 'invoice.payment_failed': {
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { status: 'payment_failed' },
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        // Only update for subscription invoices with a real charge — trials
        // fire a $0 invoice at signup which must not flip status to active.
        if (obj.subscription && obj.amount_paid > 0) {
          await prisma.subscription.updateMany({
            where: { stripeCustomerId: obj.customer },
            data: {
              status: 'active',
              ...(obj.period_start ? { currentPeriodStart: new Date(obj.period_start * 1000) } : {}),
            },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const status = obj.status === 'active' ? 'active'
          : obj.status === 'trialing' ? 'trial'
          : obj.status === 'past_due' ? 'payment_failed'
          : obj.status === 'canceled' ? 'inactive'
          : obj.status;

        const priceId = obj.items?.data?.[0]?.price?.id;
        const soloPrices = [process.env.STRIPE_SOLO_MONTHLY_PRICE_ID, process.env.STRIPE_SOLO_ANNUAL_PRICE_ID];
        const publisherPrices = [process.env.STRIPE_PUBLISHER_MONTHLY_PRICE_ID, process.env.STRIPE_PUBLISHER_ANNUAL_PRICE_ID];
        const plan = soloPrices.includes(priceId) ? 'solo'
          : publisherPrices.includes(priceId) ? 'publisher'
          : undefined;

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: obj.id },
          data: {
            status,
            ...(plan ? { plan } : {}),
            ...(obj.trial_end ? { trialEndsAt: new Date(obj.trial_end * 1000) } : {}),
          },
        });

        // Detect the exact moment cancel-at-period-end is turned on (the user
        // canceled from the billing portal). previous_attributes only contains
        // cancel_at_period_end when it just changed, so this fires once.
        const prev = event.data.previous_attributes;
        if (obj.cancel_at_period_end === true && prev?.cancel_at_period_end === false) {
          const accessEndsDate = obj.cancel_at ? new Date(obj.cancel_at * 1000)
            : obj.trial_end ? new Date(obj.trial_end * 1000)
            : obj.current_period_end ? new Date(obj.current_period_end * 1000)
            : null;
          const sub = await prisma.subscription.findFirst({
            where: { stripeSubscriptionId: obj.id },
            include: { organization: { include: { users: true, shows: { take: 1 } } } },
          });
          if (sub?.organization) {
            const showName = sub.organization.shows[0]?.name ?? sub.organization.name;
            for (const orgUser of sub.organization.users) {
              sendCancellationEmail({ to: orgUser.email, showName, accessEndsDate })
                .catch(err => console.error('Cancellation email failed:', err.message));
            }
            const customerEmail = sub.organization.users[0]?.email ?? 'unknown';
            sendCancellationAdminEmail({ orgName: sub.organization.name, showName, userEmail: customerEmail, accessEndsDate })
              .catch(err => console.error('Cancellation admin email failed:', err.message));
            sendSMS(`LocalPod cancellation: ${customerEmail} (${showName}) — access ends ${accessEndsDate ? accessEndsDate.toISOString().slice(0, 10) : 'period end'}`)
              .catch(err => console.error('Cancellation SMS failed:', err.message));
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err.message);
    return res.status(500).json({ error: 'Internal error handling webhook' });
  }

  res.json({ received: true });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../prisma');
const { sendWelcomeEmail } = require('../email');
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
            await prisma.subscription.update({
              where: { organizationId: user.organization.id },
              data: {
                stripeCustomerId: obj.customer,
                stripeSubscriptionId: obj.subscription,
                status: 'active',
              },
            });

            const show = await prisma.show.findFirst({
              where: { organizationId: user.organization.id },
            });

            // Create Megaphone podcast if not already created
            if (!user.organization.megaphoneShowId) {
              try {
                const adapter = getHostingAdapter();
                const showTitle = show?.name ?? user.organization.name;
                const slug = showTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const coverArtUrl = show?.coverArtUrl ?? null;
                const { id: megaphoneShowId, rssUrl } = await adapter.createPodcast({
                  title: showTitle,
                  slug,
                  summary: show?.description,
                  category: show?.category,
                  author: show?.author || showTitle,
                  ownerName: show?.author || showTitle,
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

                await prisma.organization.update({
                  where: { id: user.organization.id },
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
            sendSMS(`New LocalPod subscriber: ${obj.customer_email} (${show?.name ?? user.organization.name})`)
              .catch(err => console.error('SMS alert failed:', err.message));
          }
        }
        break;
      }

      case 'customer.subscription.created': {
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { status: 'active' },
        });
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
        // Only update if this is for a subscription (not a one-off invoice)
        if (obj.subscription) {
          await prisma.subscription.updateMany({
            where: { stripeCustomerId: obj.customer },
            data: { status: 'active' },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const status = obj.status === 'active' ? 'active'
          : obj.status === 'past_due' ? 'payment_failed'
          : obj.status === 'canceled' ? 'inactive'
          : obj.status;
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: obj.id },
          data: { status },
        });
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

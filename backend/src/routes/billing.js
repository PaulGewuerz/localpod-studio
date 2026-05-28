const express = require('express');
const router = require('express').Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../prisma');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');

const PRICE_IDS = {
  solo:      { monthly: process.env.STRIPE_SOLO_MONTHLY_PRICE_ID,      annual: process.env.STRIPE_SOLO_ANNUAL_PRICE_ID },
  publisher: { monthly: process.env.STRIPE_PUBLISHER_MONTHLY_PRICE_ID, annual: process.env.STRIPE_PUBLISHER_ANNUAL_PRICE_ID },
};

router.post('/create-checkout-session', async (req, res) => {
  const { email, plan = 'publisher', interval = 'monthly' } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const priceId = PRICE_IDS[plan]?.[interval];
  if (!priceId) return res.status(400).json({ error: `No price configured for plan=${plan} interval=${interval}` });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { plan, interval },
      allow_promotion_codes: true,
      success_url: `${process.env.FRONTEND_URL || 'https://app.localpod.co'}/studio?checkout=success`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://app.localpod.co'}/onboarding`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/portal-session', requireActiveSubscription, async (req, res) => {
  const subscription = req.user.organization?.subscription;
  if (!subscription?.stripeCustomerId) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL || 'https://app.localpod.co'}/studio?nav=billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
const express = require('express');
const router = require('express').Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../prisma');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');

router.post('/create-checkout-session', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
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
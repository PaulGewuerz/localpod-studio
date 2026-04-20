require('dotenv').config();
const express = require('express');
const app = express();

// Webhook route must come before express.json() — Stripe needs the raw body
app.use('/webhooks', require('./routes/webhooks'));

app.use(express.json());
const cors = require('cors');
app.use(cors({
  origin: [
    'https://app.localpod.co',
    'http://localhost:3000',
    'http://192.168.1.202:3000',
  ],
  credentials: true,
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const requireActiveSubscription = require('./middleware/requireActiveSubscription');
const requireAuth = require('./middleware/requireAuth');
app.use('/generate', requireActiveSubscription, require('./routes/generate'));
app.use('/upload-audio', requireActiveSubscription, require('./routes/uploadAudio'));
app.use('/publish', requireActiveSubscription, require('./routes/publish'));
app.use('/schedule', requireActiveSubscription, require('./routes/schedule'));

app.use('/voices', requireActiveSubscription, require('./routes/voices'));
app.use('/episodes', requireActiveSubscription, require('./routes/episodes'));
app.use('/me', requireAuth, require('./routes/me'));
app.use('/auth', require('./routes/auth'));

app.use('/analytics', requireActiveSubscription, require('./routes/analytics'));
app.use('/billing', require('./routes/billing'));
app.use('/admin', require('./middleware/requireAdmin'), require('./routes/admin'));
app.use('/pronunciation', require('./routes/pronunciation'));
app.use('/support', require('./routes/support'));

if (process.env.NODE_ENV !== 'production') {
  app.use('/dev-login', require('./routes/devLogin'));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LocalPod backend running on http://localhost:${PORT}`);
});
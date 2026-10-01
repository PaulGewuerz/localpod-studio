const crypto = require('crypto');

// Prefix identifies the key as a LocalPod live API key. If test/sandbox keys
// are ever added, introduce lpk_test_ alongside this.
const KEY_PREFIX = 'lpk_live_';

// sha256 of the full key. The key itself is 192 bits of entropy, so a fast hash
// is the right primitive here (same approach as GitHub/Stripe tokens) — bcrypt
// is for low-entropy passwords, not random secrets.
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Returns { key, keyHash, keyPrefix }. `key` is the raw secret to hand to the
// caller once and never persist; only keyHash + keyPrefix are stored.
function generateApiKey() {
  const secret = crypto.randomBytes(24).toString('base64url'); // 32 url-safe chars
  const key = `${KEY_PREFIX}${secret}`;
  return {
    key,
    keyHash: hashApiKey(key),
    keyPrefix: key.slice(0, 16), // e.g. "lpk_live_a1b2c3d" — safe to display
  };
}

function isApiKey(token) {
  return typeof token === 'string' && token.startsWith('lpk_');
}

module.exports = { generateApiKey, hashApiKey, isApiKey, KEY_PREFIX };

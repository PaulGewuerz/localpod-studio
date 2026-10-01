const { supabase } = require('../supabase');
const prisma = require('../prisma');
const { hashApiKey, isApiKey } = require('./apiKeys');

// Resolves the Authorization bearer credential to a DB user (org + subscription
// included). Accepts either:
//   - a partner API key (lpk_…), authenticating as its owning Organization, or
//   - a Supabase session JWT, authenticating as the signed-in user.
// For the admin JWT, X-Impersonate-Email resolves a customer instead so the
// admin can see and act as them.
// Returns { dbUser, impersonatedBy?, apiKeyId? } or { status, error }.
module.exports = async function resolveAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { status: 401, error: 'Missing or invalid authorization header' };
  }

  const token = authHeader.slice(7);

  if (isApiKey(token)) {
    return resolveApiKey(req, token);
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { status: 401, error: 'Invalid or expired token' };
  }

  let email = user.email;
  const impersonateEmail = req.headers['x-impersonate-email'];
  if (impersonateEmail) {
    if (!process.env.ADMIN_EMAIL || user.email !== process.env.ADMIN_EMAIL) {
      return { status: 403, error: 'Admin access required' };
    }
    email = impersonateEmail;
  }

  const dbUser = await prisma.user.findUnique({
    where: { email },
    include: { organization: { include: { subscription: true } } },
  });

  if (!dbUser) {
    return { status: 403, error: 'User not found' };
  }

  if (impersonateEmail) {
    console.log(`[impersonation] ${user.email} acting as ${impersonateEmail} — ${req.method} ${req.originalUrl}`);
    return { dbUser, impersonatedBy: user.email };
  }
  return { dbUser };
};

// Resolves a partner API key to an org-scoped dbUser shaped like the JWT path
// (organization + subscription), with a representative user attached so routes
// that read req.user.id/.email keep working. Impersonation is JWT-only and is
// intentionally ignored for API keys.
async function resolveApiKey(req, token) {
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: { organization: { include: { subscription: true } } },
  });

  if (!apiKey || apiKey.revokedAt) {
    return { status: 401, error: 'Invalid or revoked API key' };
  }

  // Best-effort usage tracking; never block the request on it.
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(err => console.error('[apiKey] failed to update lastUsedAt:', err.message));

  const org = apiKey.organization;
  const representative = await prisma.user.findFirst({
    where: { organizationId: org.id },
    orderBy: { createdAt: 'asc' },
  });

  const dbUser = {
    id: representative?.id ?? null,
    email: representative?.email ?? null,
    name: representative?.name ?? apiKey.name,
    organizationId: org.id,
    organization: org,
  };

  return { dbUser, apiKeyId: apiKey.id };
}

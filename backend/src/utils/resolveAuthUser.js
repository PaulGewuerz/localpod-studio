const { supabase } = require('../supabase');
const prisma = require('../prisma');

// Resolves the Authorization bearer token to a DB user (org + subscription
// included). If the token belongs to ADMIN_EMAIL and X-Impersonate-Email is
// set, resolves that user instead so the admin can see and act as a customer.
// Returns { dbUser, impersonatedBy? } or { status, error }.
module.exports = async function resolveAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { status: 401, error: 'Missing or invalid authorization header' };
  }

  const token = authHeader.slice(7);
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

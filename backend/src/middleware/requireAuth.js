const resolveAuthUser = require('../utils/resolveAuthUser');

module.exports = async function requireAuth(req, res, next) {
  const result = await resolveAuthUser(req);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  req.user = result.dbUser;
  if (result.impersonatedBy) req.impersonatedBy = result.impersonatedBy;
  next();
};

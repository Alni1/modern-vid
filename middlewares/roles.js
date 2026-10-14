// Access checks that build on utils/auth.js: staff roles and restricted (banned) accounts.
const { requireAuth } = require('../utils/auth');
const { isModerator, isAdmin, isBanned } = require('../utils/moderation');

const wantsJson = (req) => req.originalUrl.startsWith('/api/') || req.xhr || (req.get('accept') || '').includes('application/json');

function deny(req, res, status, message) {
  if (wantsJson(req)) return res.status(status).json({ error: message, message });
  return res.status(status).render('error', { message, error: { status }, user: req.user || null });
}

/** Signed in as a moderator or an administrator. */
function requireModerator(req, res, next) {
  requireAuth(req, res, () => (isModerator(req.user) ? next() : deny(req, res, 403, 'This page is for moderators.')));
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => (isAdmin(req.user) ? next() : deny(req, res, 403, 'Only administrators can do this.')));
}

/** Signed in and not restricted: uploading, commenting and reporting. */
function requireActiveUser(req, res, next) {
  requireAuth(req, res, () => {
    if (!isBanned(req.user)) return next();
    const until = new Date(req.user.bannedUntil);
    const when = until.getFullYear() > 9000 ? 'permanently' : `until ${until.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
    deny(req, res, 403, `Your account is restricted ${when}${req.user.banReason ? ` (${req.user.banReason})` : ''}.`);
  });
}

module.exports = { requireModerator, requireAdmin, requireActiveUser };

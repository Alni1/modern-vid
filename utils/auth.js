// Sign-in sessions: a short-lived access token (JWT) and a long-lived refresh token, both in
// httpOnly cookies. Pages are rendered on the server, so the session is refreshed by the
// middleware itself: when the access token has expired, the refresh token is exchanged for a new
// pair during the same request, and the user stays signed in while visiting the site.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../schemas/userSchema');
const RefreshToken = require('../schemas/RefreshToken');

const ACCESS_COOKIE = 'token';
const REFRESH_COOKIE = 'refresh';
const ACCESS_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days since the last visit
/**
 * A rotated token used again within this time is a parallel request of the same browser
 * (a page and its scripts refreshing at once), not a stolen token.
 */
const REUSE_GRACE_MS = 30 * 1000;

const secret = () => {
  if (!process.env.SECRET_KEY) throw new Error('SECRET_KEY is not set');
  return process.env.SECRET_KEY;
};

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

function cookieOptions(maxAge) {
  return {
    httpOnly: true, // not readable from page scripts
    sameSite: 'lax', // not sent with cross-site POST requests (CSRF protection)
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

function signAccess(userId) {
  return jwt.sign({ sub: String(userId), typ: 'access' }, secret(), { expiresIn: ACCESS_TTL_SEC });
}

/** Returns the user id of a valid access token, or null. Tokens of other types are rejected. */
function verifyAccess(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    return payload && payload.typ === 'access' && mongoose.isValidObjectId(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Issue time (seconds) of an access token that verifyAccess has accepted. */
function accessIssuedAt(token) {
  const payload = jwt.decode(token);
  return payload && payload.iat ? payload.iat : 0;
}

function setAccessCookie(res, userId) {
  res.cookie(ACCESS_COOKIE, signAccess(userId), cookieOptions(ACCESS_TTL_SEC * 1000));
}

async function setRefreshCookie(req, res, userId, family) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await RefreshToken.create({
    user: userId,
    hash: hashToken(raw),
    family: family || crypto.randomUUID(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: String(req.get('user-agent') || '').slice(0, 200),
  });
  res.cookie(REFRESH_COOKIE, raw, cookieOptions(REFRESH_TTL_MS));
}

/** Starts a new session after sign-in or registration. */
async function issueSession(req, res, user) {
  setAccessCookie(res, user._id);
  await setRefreshCookie(req, res, user._id);
}

function clearCookies(res) {
  const { maxAge, ...opts } = cookieOptions(0); // eslint-disable-line no-unused-vars
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
}

/**
 * Exchanges a refresh token for a new pair (rotation). Returns the user id or null.
 * A token that was already exchanged and is used again later than REUSE_GRACE_MS means that
 * it was copied: the whole family is revoked and both the thief and the owner must sign in again.
 */
async function rotate(req, res, raw) {
  const hash = hashToken(raw);
  const now = new Date();
  // Atomic: of two parallel requests only one revokes the token and issues a new one.
  const doc = await RefreshToken.findOneAndUpdate(
    { hash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, rotatedAt: now } },
    { new: false },
  ).lean();
  if (doc) {
    setAccessCookie(res, doc.user);
    await setRefreshCookie(req, res, doc.user, doc.family);
    return String(doc.user);
  }
  const used = await RefreshToken.findOne({ hash }).lean();
  if (!used || used.expiresAt <= now) return null;
  // A parallel request of the same browser: the token was rotated a moment ago and the session
  // was not ended since (sign-out and theft detection mark the whole family as ended).
  if (used.rotatedAt && !used.endedAt && now - used.rotatedAt <= REUSE_GRACE_MS) {
    // The other request has already set the new refresh cookie.
    setAccessCookie(res, used.user);
    return String(used.user);
  }
  await endFamily(used.family, now);
  console.warn(`[auth] reuse of a rotated refresh token, session family ${used.family} revoked`);
  return null;
}

/** Ends a sign-in session: revokes all tokens of the family and disables the grace period. */
async function endFamily(family, now = new Date()) {
  await RefreshToken.updateMany({ family, revokedAt: null }, { $set: { revokedAt: now } });
  await RefreshToken.updateMany({ family }, { $set: { endedAt: now } });
}

/** Resolves the signed-in user of a request (refreshing the session if needed). */
async function authenticate(req, res) {
  if (req._authChecked) return req.user || null;
  req._authChecked = true;
  const cookies = req.cookies || {};
  let userId = verifyAccess(cookies[ACCESS_COOKIE]);
  let user = userId ? await User.findById(userId).select('-password').lean() : null;
  // "Sign out everywhere" (or a ban) also invalidates access tokens issued before it.
  if (user && user.sessionsRevokedAt && accessIssuedAt(cookies[ACCESS_COOKIE]) < Math.floor(new Date(user.sessionsRevokedAt).getTime() / 1000)) {
    user = null;
  }
  if (!user && cookies[REFRESH_COOKIE]) {
    userId = await rotate(req, res, cookies[REFRESH_COOKIE]);
    user = userId ? await User.findById(userId).select('-password').lean() : null;
  }
  if (!user && (cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE])) clearCookies(res);
  req.user = user || undefined;
  return user;
}

const wantsJson = (req) => req.originalUrl.startsWith('/api/') || req.xhr || (req.get('accept') || '').includes('application/json');

/** Middleware: sets req.user when the visitor is signed in. */
function optionalAuth(req, res, next) {
  authenticate(req, res).then(() => next(), next);
}

/** Middleware: pages redirect to the login form (and back afterwards), the API answers 401. */
function requireAuth(req, res, next) {
  authenticate(req, res).then((user) => {
    if (user) return next();
    if (wantsJson(req)) return res.status(401).json({ error: 'Sign in required' });
    const back = req.method === 'GET' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
    res.redirect('/login' + back);
  }, next);
}

/** Local path to return to after sign-in; anything else (other sites, //host) becomes '/'. */
function safeNext(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/';
}

/** Signs out of this browser: revokes the session family of the refresh cookie. */
async function signOut(req, res) {
  const raw = req.cookies && req.cookies[REFRESH_COOKIE];
  if (raw) {
    const doc = await RefreshToken.findOne({ hash: hashToken(raw) }).select('family').lean();
    if (doc) await endFamily(doc.family);
  }
  clearCookies(res);
}

/** Signs out everywhere: revokes all refresh tokens of the user and the access tokens issued so far. */
async function signOutEverywhere(userId, res) {
  const now = new Date();
  await User.updateOne({ _id: userId }, { $set: { sessionsRevokedAt: now } });
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: now } });
  await RefreshToken.updateMany({ user: userId }, { $set: { endedAt: now } });
  if (res) clearCookies(res);
}

/**
 * One-time clean-up of the first authentication scheme: registration used to store a JWT without
 * an expiry date in the user document (field JWT with a unique index). Such tokens are no longer
 * accepted; the field and its index are removed.
 */
async function migrateLegacyAuth() {
  const users = User.collection;
  try {
    const indexes = await users.indexes();
    if (indexes.some((i) => i.name === 'JWT_1')) await users.dropIndex('JWT_1');
  } catch (err) {
    if (err.codeName !== 'NamespaceNotFound') console.warn('[auth] could not drop the JWT index:', err.message);
  }
  const { modifiedCount } = await users.updateMany({ JWT: { $exists: true } }, { $unset: { JWT: '' } });
  if (modifiedCount) console.log(`[auth] removed stored tokens of the first version from ${modifiedCount} accounts`);
}

module.exports = {
  ACCESS_COOKIE, REFRESH_COOKIE, ACCESS_TTL_SEC, REFRESH_TTL_MS, REUSE_GRACE_MS,
  hashToken, signAccess, verifyAccess, safeNext,
  issueSession, authenticate, optionalAuth, requireAuth, signOut, signOutEverywhere, migrateLegacyAuth,
  clearSessionCookies: clearCookies,
};

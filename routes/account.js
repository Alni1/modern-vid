// Account settings of the signed-in user: display name, login and password.
const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const User = require('../schemas/userSchema');
const { requireAuth, signOutEverywhere, issueSession } = require('../utils/auth');
const { loginError, displayNameError, normalizeLogin } = require('../utils/accounts');

const router = express.Router();
router.use(requireAuth);

/** Express 4 does not catch rejected promises of async handlers: pass them to the error handler. */
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Changes that need the password: at most 10 attempts per 15 minutes (password guessing). */
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

async function checkPassword(req, res) {
  const user = await User.findById(req.user._id).select('password').lean();
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!user || !password || !(await bcrypt.compare(password, user.password))) {
    res.status(400).json({ error: 'The current password is wrong.', field: 'password' });
    return false;
  }
  return true;
}

router.post('/name', wrap(async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const error = displayNameError(username);
  if (error) return res.status(400).json({ error, field: 'username' });
  await User.updateOne({ _id: req.user._id }, { $set: { username } });
  res.json({ ok: true, username });
}));

router.post('/login', sensitiveLimiter, wrap(async (req, res) => {
  const login = normalizeLogin(req.body && req.body.login);
  const error = loginError(login);
  if (error) return res.status(400).json({ error, field: 'login' });
  if (login === req.user.login) return res.status(400).json({ error: 'This is already your login.', field: 'login' });
  if (!(await checkPassword(req, res))) return;
  if (await User.exists({ login, _id: { $ne: req.user._id } })) {
    return res.status(409).json({ error: 'This login is already taken.', field: 'login' });
  }
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { login } });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ error: 'This login is already taken.', field: 'login' });
    throw err;
  }
  res.json({ ok: true, login });
}));

router.post('/password', sensitiveLimiter, wrap(async (req, res) => {
  const next = req.body && typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (next.length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters long.', field: 'newPassword' });
  if (!(await checkPassword(req, res))) return;
  const user = await User.findById(req.user._id);
  user.password = next; // hashed by the pre-save hook of the schema
  await user.save();
  // Other devices are signed out; this browser gets a fresh session.
  await signOutEverywhere(user._id);
  await issueSession(req, res, user);
  res.json({ ok: true });
}));

module.exports = router;

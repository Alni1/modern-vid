const express = require('express');
const { signOut, signOutEverywhere, requireAuth } = require('../utils/auth');

const router = express.Router();

// Sign out of this browser.
router.post('/', async (req, res, next) => {
  try {
    await signOut(req, res);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// Sign out of all devices: every session of the account ends.
router.post('/all', requireAuth, async (req, res, next) => {
  try {
    await signOutEverywhere(req.user._id, res);
    res.redirect('/login?signedOut=all');
  } catch (err) {
    next(err);
  }
});

module.exports = router;

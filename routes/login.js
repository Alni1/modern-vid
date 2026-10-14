const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../schemas/userSchema');

const rateLimit = require('express-rate-limit');

const { issueSession, safeNext } = require('../utils/auth');

// Password guessing protection: at most 10 failed attempts per IP in 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('login', {
    title: 'Login',
    error: 'Too many attempts. Please try again in 15 minutes.',
    loginValue: req.body && req.body.login,
  }),
});

router.get('/', function(req, res, next) {
    res.render('login', {
        title: 'Login',
        next: safeNext(req.query.next),
        notice: req.query.signedOut === 'all' ? 'You have been signed out on all devices.' : null,
    });
});

router.post('/', loginLimiter, async function(req, res, next) {
    const loginData = req.body;

    try {
        const user = await User.findOne({ login: loginData.login });
        // The same message for an unknown login and a wrong password (do not reveal which logins exist).
        const fail = () => res.status(400).render('login', { title: 'Login', error: 'Wrong login or password', loginValue: loginData.login, next: safeNext(loginData.next) });
        if (!user) return fail();

        const compareResult = await bcrypt.compare(loginData.password, user.password);
        if (!compareResult) return fail();
        await issueSession(req, res, user);
        return res.redirect(safeNext(loginData.next));

    } catch (e) {
        console.error("Exception occurred:", e);
        res.status(500).send("An internal error occurred");
    }
});

module.exports = router;

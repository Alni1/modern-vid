const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../schemas/userSchema');

const rateLimit = require('express-rate-limit');

const SECRET_KEY = process.env.SECRET_KEY;

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
    res.render('login', { title: "Login" });
});

router.post('/', loginLimiter, async function(req, res, next) {
    const loginData = req.body;

    try {
        const user = await User.findOne({ login: loginData.login });
        // The same message for an unknown login and a wrong password (do not reveal which logins exist).
        const fail = () => res.status(400).render('login', { title: 'Login', error: 'Wrong login or password', loginValue: loginData.login });
        if (!user) return fail();

        const compareResult = await bcrypt.compare(loginData.password, user.password);
        if (!compareResult) return fail();
        const token = jwt.sign({ id: user._id }, SECRET_KEY, { expiresIn: '7d' });

        res.cookie('token', token, {
            maxAge: 7 * 24 * 60 * 60 * 1000, 
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production' 
        });

        return res.redirect('/');

    } catch (e) {
        console.error("Exception occurred:", e);
        res.status(500).send("An internal error occurred");
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../schemas/userSchema');

const SECRET_KEY = process.env.SECRET_KEY;

router.get('/', function(req, res, next) {
    res.render('login', { title: "Login" });
});

router.post('/', async function(req, res, next) {
    const loginData = req.body;

    try {
        const user = await User.findOne({ login: loginData.login });
        if (!user) {
            return res.status(400).json({ error: 'User does not exist' });
        }

        const compareResult = await bcrypt.compare(loginData.password, user.password);
        if (!compareResult) {
            return res.status(403).json({ error: 'Password is not correct' });
        }
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

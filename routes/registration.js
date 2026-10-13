const logger = require('../logger');
const express = require('express');
const router = express.Router();


const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const User = require('../schemas/userSchema');

// Mass sign-up protection: at most 5 new accounts per IP per hour.
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  skipFailedRequests: true,
  handler: (req, res) => res.status(429).render('registration', { title: 'Registration', error: 'Too many sign-ups from this network. Please try again later.' }),
});


router.get('/', function(req, res, next){ 
    res.render('registration', {title: "Registration"})
});


router.post('/', registrationLimiter, async function(req, res, next){

    const { login, password, username } = req.body;

    if (!password || password.length < 6) {
        return res.status(400).render('registration', {
            title: "Registration",
            error: "Password must be at least 6 characters long.",
            
            loginValue: login,
            usernameValue: username
        });
    }

    const user = new User({ login, password, username }); 
    try {

        await user.save(); 
        
        res.cookie('token', user.JWT, {
            maxAge: 604800000,
            httpOnly: true, // not readable from page scripts
            secure: process.env.NODE_ENV === 'production',
        })
        .redirect('/');
    } catch (e) {
        logger.info(e); 

        if (e.name === 'ValidationError') {
            let errors = {};
            for (let field in e.errors) {
                errors[field] = e.errors[field].message;
            }
      
            return res.status(400).render('registration', {
                title: "Registration",
                validationError: errors, 
                loginValue: login,
                usernameValue: username
            });
        }

        if (e.code === 11000) {
            return res.status(409).render('registration', {
                title: "Registration",
                error: "This login is already taken.",
                loginValue: login,
                usernameValue: username
            });
        }

        return res.status(500).render('registration', {
            title: "Registration",
            error: "An unexpected error occurred during registration.",
            loginValue: login,
            usernameValue: username
        });
    }
})

module.exports = router;
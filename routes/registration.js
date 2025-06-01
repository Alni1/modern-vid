const logger = require('../logger');
const express = require('express');
const router = express.Router();


const mongoose = require('mongoose');
const User = require('../schemas/userSchema');


router.get('/', function(req, res, next){ 
    res.render('registration', {title: "Registration"})
});


router.post('/', async function(req, res, next){

    const { login, password, username } = req.body;

    if (!password || password.length < 6) {
        return res.render('registration', {
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
      
            return res.render('registration', {
                title: "Registration",
                validationError: errors, 
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
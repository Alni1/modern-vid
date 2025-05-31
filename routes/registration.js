//logger import
const logger = require('../logger');

//Express libraries import
const express = require('express');
const router = express.Router();

//mongoose and user for work with DB
const mongoose = require('mongoose');
const User = require('../schemas/userSchema');

// page render
router.get('/', function(req, res, next){ 
    res.render('registration', {title: "Registration"})
});

//user registration request
router.post('/', async function(req, res, next){
    //creating payload for creating document in db
    const { login, password, username } = req.body;

    if (!password || password.length < 6) {
        return res.render('registration', {
            title: "Registration",
            error: "Password must be at least 6 characters long.",
            // Передаем введенные значения обратно в форму, чтобы пользователь не вводил все заново
            loginValue: login,
            usernameValue: username
        });
    }

    const user = new User({ login, password, username }); // Создаем пользователя только с нужными полями

    try {
        //save user data
        await user.save(); // хук pre('save') сгенерирует uuid, timestamp, JWT и захэширует пароль
        
        //sent cookie to user for easy auth
        res.cookie('token', user.JWT, { // user.JWT должен быть доступен после user.save()
            maxAge: 604800000, // 7 дней
            secure: process.env.NODE_ENV === 'production', // secure cookie в продакшене
            httpOnly: true
        })
        .redirect('/');
    } catch (e) {
        logger.info(e); // Логируем полную ошибку
        // Обрабатываем специфичные ошибки Mongoose, если нужно
        if (e.name === 'ValidationError') {
            let errors = {};
            for (let field in e.errors) {
                errors[field] = e.errors[field].message;
            }
            // Можно передать эти ошибки в шаблон
            return res.render('registration', {
                title: "Registration",
                validationError: errors, // Передаем объект с ошибками валидации
                loginValue: login,
                usernameValue: username
            });
        }
        // Общая ошибка
        return res.status(500).render('registration', {
            title: "Registration",
            error: "An unexpected error occurred during registration.",
            loginValue: login,
            usernameValue: username
        });
    }
})

module.exports = router;
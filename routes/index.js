const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../schemas/userSchema');
const VideoMeta = require('../schemas/VideoMeta');


router.get('/', async function(req, res, next) {
  const token = req.cookies.token;  
  let user = null;
  let videos = [];

  if (token) {
    try {
      const verification = jwt.verify(token, process.env.SECRET_KEY);
      user = await User.findById(verification.id).lean();
    } catch (err) {
      console.error('Token verification failed:', err.message);
    }
  }

  try {

    videos = await VideoMeta.find()
      .sort({ uploadedAt: -1 })

      .populate('user', 'username avatarUrl')
      .lean();
  } catch (err) {
    console.error('Error loading videos:', err.message);
  }

  res.render('index', { title: 'ModernVid', user, videos });
});

module.exports = router;

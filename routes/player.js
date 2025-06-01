const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const User = require('../schemas/userSchema'); 
const { ref, getDownloadURL } = require('firebase/storage');
const VideoMeta = require('../schemas/VideoMeta');
const { firebaseStorage } = require('../firebase-init');
const rateLimit = require('express-rate-limit');

const playerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});


router.get('/:id', playerRateLimiter, async (req, res) => {
  try {
    let currentUser = null;
    const token = req.cookies.token;

    if (token && process.env.SECRET_KEY) {
      try {
        const decoded = jwt.verify(token, process.env.SECRET_KEY);
        currentUser = await User.findById(decoded.id).lean();
      } catch (err) {
        console.warn('Player page: Invalid or expired token, proceeding as guest.', err.message);

        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            res.clearCookie('token');
        }
      }
    }

    const video = await VideoMeta.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    )
    .populate('user', 'username avatarUrl') 
    .populate({ 
      path: 'comments',
      populate: { 
        path: 'user',
        select: 'username avatarUrl' 
      },
      options: { sort: { createdAt: -1 } } 
    });

    if (!video) {
      return res.status(404).render('error', { message: 'Video not found', error: { status: 404 }, user: currentUser });
    }
    if (!firebaseStorage) {
      console.error('[PLAYER_ROUTE_ERROR] firebaseStorage is not available!');
      return res.status(500).render('error', { message: 'Server configuration error (Firebase Storage)', error: { status: 500 }, user: currentUser });
    }
    if (!video.firebasePath) {
        console.error(`[PLAYER_ROUTE_ERROR] Video with ID ${video._id} has no firebasePath.`);
        return res.status(500).render('error', { message: 'Video data is incomplete (missing Firebase path)', error: { status: 500 }, user: currentUser });
    }

    const videoRef = ref(firebaseStorage, video.firebasePath);
    const videoUrl = await getDownloadURL(videoRef);

    
    const recommendedVideos = await VideoMeta.find({ _id: { $ne: video._id } }) 
      .sort({ uploadedAt: -1 })
      .limit(5) 
      .select('title user thumbnailUrl views uploadedAt')
      .populate('user', 'username avatarUrl') 
      .lean();
 
    res.render('player', {
      title: video.title,
      description: video.description,
      videoUrl,
      video,
      user: currentUser, 
      recommendedVideos 
    });
  } catch (err) {
    console.error('Error loading player page:', err);
    res.status(500).render('error', { message: 'Server error' });
  }
});


router.get('/stream/:id', async (req, res) => {
  try {
    const video = await VideoMeta.findById(req.params.id);
    if (!video) return res.status(404).send('Video not found');

    if (!firebaseStorage) {
      console.error('[STREAM_ROUTE_ERROR] firebaseStorage is not available!');
      return res.status(500).send('Server configuration error (Firebase Storage)');
    }
    if (!video.firebasePath) {
        console.error(`[STREAM_ROUTE_ERROR] Video with ID ${video._id} has no firebasePath.`);
        return res.status(500).send('Video data is incomplete (missing Firebase path)');
    }
    const videoRef = ref(firebaseStorage, video.firebasePath);
    const videoUrl = await getDownloadURL(videoRef);

    
    res.redirect(videoUrl);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
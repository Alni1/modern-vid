const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); // Added for token verification
const User = require('../schemas/userSchema'); // Added for fetching user
const { ref, getDownloadURL } = require('firebase/storage');
const VideoMeta = require('../schemas/VideoMeta');
const { firebaseStorage } = require('../firebase-init'); // Import firebaseStorage directly
const rateLimit = require('express-rate-limit');

const playerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// Получение метаданных видео и рендер страницы
// Changed route from '/player/:id' to '/:id' as it's mounted on '/player' in app.js
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
        // Not a critical error for viewing, user is simply not logged in.
        // Clear cookie if token is invalid
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
    .populate('user', 'username avatarUrl') // Populate user who uploaded the video
    .populate({ // Populate comments
      path: 'comments',
      populate: { // For each comment, populate the user who wrote it
        path: 'user',
        select: 'username avatarUrl' // Select specific fields from user
      },
      options: { sort: { createdAt: -1 } } // Sort comments by newest first
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

    // Fetch other videos for recommendations (e.g., 5 latest, excluding current)
    const recommendedVideos = await VideoMeta.find({ _id: { $ne: video._id } }) // Exclude current video
      .sort({ uploadedAt: -1 })
      .limit(5) // Limit to 5 recommendations
      .select('title user thumbnailUrl views uploadedAt') // Explicitly select necessary fields
      .populate('user', 'username avatarUrl') // Populate uploader's username and avatar
      .lean();
 
    res.render('player', {
      title: video.title,
      description: video.description,
      videoUrl,
      video,
      user: currentUser, // Pass the determined user (or null) to the template
      recommendedVideos // Pass recommended videos to the template
    });
  } catch (err) {
    console.error('Error loading player page:', err);
    res.status(500).render('error', { message: 'Server error' });
  }
});

// Стриминг видео с поддержкой Range-запросов
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
    const videoRef = ref(firebaseStorage, video.firebasePath); // Use imported firebaseStorage
    const videoUrl = await getDownloadURL(videoRef);

    // Перенаправляем запрос к Firebase Storage
    // Firebase сам обработает Range-запросы
    res.redirect(videoUrl);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const User = require('../schemas/userSchema'); 
const mongoose = require('mongoose');
const VideoMeta = require('../schemas/VideoMeta');
const storage = require('../utils/storage');
const rateLimit = require('express-rate-limit');

const playerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});


router.get('/:id', playerRateLimiter, async (req, res) => {
  let currentUser = null;
  try {
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

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).render('error', { message: 'Video not found', error: { status: 404 }, user: currentUser });
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
    // Videos from the first version were stored in Firebase Storage, which is no longer available.
    const playable = Boolean(video.storageKey);

    const recommendedVideos = await VideoMeta.find({ _id: { $ne: video._id } }) 
      .sort({ uploadedAt: -1 })
      .limit(5) 
      .select('title user thumbnailUrl views uploadedAt')
      .populate('user', 'username avatarUrl') 
      .lean();
 
    res.render('player', {
      title: video.title,
      description: video.description,
      playable,
      video,
      user: currentUser, 
      recommendedVideos 
    });
  } catch (err) {
    console.error('Error loading player page:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 }, user: currentUser });
  }
});


// Redirects the player to the media file in the storage.
router.get('/stream/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Video not found');
    const video = await VideoMeta.findById(req.params.id).select('storageKey').lean();
    if (!video) return res.status(404).send('Video not found');
    if (!video.storageKey) return res.status(410).send('This video was stored in the old storage and is no longer available');
    res.redirect(storage.getUrl(video.storageKey));
  } catch (err) {
    console.error('Error streaming video:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
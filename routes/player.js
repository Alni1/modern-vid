const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const User = require('../schemas/userSchema'); 
const mongoose = require('mongoose');
const VideoMeta = require('../schemas/VideoMeta');
const storage = require('../utils/storage');
const { loadPreset } = require('./presets');
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
    const processing = video.status === 'processing';
    // Adaptive HLS stream when transcoding is finished; the original file is the fallback.
    const hlsUrl = video.status === 'ready' && video.hls && video.hls.masterKey ? storage.getUrl(video.hls.masterKey) : null;
    const progressiveUrl = `/player/stream/${video._id}`;
    // Seek-bar preview frames (WebVTT + sprite sheets), produced together with the first quality.
    const thumbnailsUrl = hlsUrl && video.previewsKey ? storage.getUrl(video.previewsKey) : null;

    const recommendedVideos = await VideoMeta.find({ _id: { $ne: video._id }, status: { $ne: 'processing' } })
      .sort({ uploadedAt: -1 })
      .limit(12)
      .select('title user thumbnailUrl views uploadedAt duration')
      .populate('user', 'username avatarUrl') 
      .lean();
 
    // Player customization: the channel's theme and the signed-in viewer's own settings.
    const [authorConfig, viewerPreset] = await Promise.all([
      video.user ? loadPreset(video.user._id, 'author') : null,
      currentUser ? loadPreset(currentUser._id, 'viewer') : null,
    ]);
    const authorTheme = authorConfig && authorConfig.theme ? authorConfig.theme : null;

    const channelVideos = video.user ? await VideoMeta.countDocuments({ user: video.user._id }) : 0;

    res.render('player', {
      channelVideos,
      title: video.title,
      authorTheme,
      viewerPreset: currentUser ? viewerPreset || {} : null,
      description: video.description,
      playable,
      processing,
      hlsUrl,
      progressiveUrl,
      thumbnailsUrl,
      video,
      user: currentUser, 
      recommendedVideos 
    });
  } catch (err) {
    console.error('Error loading player page:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 }, user: currentUser });
  }
});


// Processing state, polled by the watch page while the video is being transcoded.
router.get('/status/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Video not found' });
  const video = await VideoMeta.findById(req.params.id).select('status processingProgress').lean();
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json({ status: video.status || 'ready', progress: video.processingProgress || 0 });
});

// Redirects the player to the original media file in the storage.
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
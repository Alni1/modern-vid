const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const VideoMeta = require('../schemas/VideoMeta');
const storage = require('../utils/storage');
const { loadPreset } = require('./presets');
const recommendations = require('../utils/recommendations');
const { canSeeHidden, isModerator, REASONS } = require('../utils/moderation');
const rateLimit = require('express-rate-limit');
const { optionalAuth } = require('../utils/auth');

const playerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});


router.get('/:id', playerRateLimiter, optionalAuth, async (req, res) => {
  const currentUser = req.user || null;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).render('error', { message: 'Video not found', error: { status: 404 }, user: currentUser });
    }

    const video = await VideoMeta.findById(req.params.id)
      .populate('user', 'username avatarUrl')
      .populate({
        path: 'comments',
        populate: { path: 'user', select: 'username avatarUrl' },
        options: { sort: { createdAt: -1 } },
      })
      .lean();

    if (!video) {
      return res.status(404).render('error', { message: 'Video not found', error: { status: 404 }, user: currentUser });
    }
    // A video hidden by moderators is shown only to its author (with the reason) and to moderators.
    const ownerId = video.user ? video.user._id : null;
    if (video.hiddenAt && !canSeeHidden(currentUser, ownerId)) {
      return res.status(404).render('error', { message: 'This video is not available', error: { status: 404 }, user: currentUser });
    }
    if (!video.hiddenAt) {
      await VideoMeta.updateOne({ _id: video._id }, { $inc: { views: 1 } });
      video.views = (video.views || 0) + 1;
    }
    // Hidden comments: visible to their authors and to moderators only (marked as hidden).
    video.comments = (video.comments || []).filter((c) => c && (!c.hiddenAt || canSeeHidden(currentUser, c.user && c.user._id)));

    // Videos from the first version were stored in Firebase Storage, which is no longer available.
    const playable = Boolean(video.storageKey);
    const processing = video.status === 'processing';
    // Adaptive HLS stream when transcoding is finished; the original file is the fallback.
    const hlsUrl = video.status === 'ready' && video.hls && video.hls.masterKey ? storage.getUrl(video.hls.masterKey) : null;
    const progressiveUrl = `/player/stream/${video._id}`;
    // Seek-bar preview frames (WebVTT + sprite sheets), produced together with the first quality.
    const thumbnailsUrl = hlsUrl && video.previewsKey ? storage.getUrl(video.previewsKey) : null;

    // "Up next": content similarity, watched share, freshness and co-watching (utils/recommend.js).
    // Videos the signed-in viewer has already watched to the end are skipped.
    const recSelect = 'title user thumbnailUrl views uploadedAt duration';
    let recommendedVideos = [];
    try {
      if (video.status !== 'ready') throw new Error('only ready videos have recommendations');
      const watched = currentUser ? await recommendations.watchedBy(currentUser._id) : [];
      const ids = await recommendations.forVideo(video._id, { limit: 12, exclude: watched });
      const found = await VideoMeta.find({ _id: { $in: ids }, status: 'ready', hiddenAt: null }).select(recSelect).populate('user', 'username avatarUrl').lean();
      const byId = new Map(found.map((v) => [String(v._id), v]));
      recommendedVideos = ids.map((id) => byId.get(id)).filter(Boolean);
    } catch (err) {
      if (video.status === 'ready') console.error('Recommendations failed, showing the latest videos:', err.message);
    }
    if (recommendedVideos.length < 12) {
      // Not enough recommendations (small catalogue or an error): fill up with the latest videos.
      const have = recommendedVideos.map((v) => v._id).concat(video._id);
      const latest = await VideoMeta.find({ _id: { $nin: have }, status: { $ne: 'processing' }, hiddenAt: null })
        .sort({ uploadedAt: -1 }).limit(12 - recommendedVideos.length)
        .select(recSelect).populate('user', 'username avatarUrl').lean();
      recommendedVideos = recommendedVideos.concat(latest);
    }
 
    // Player customization: the channel's theme and the signed-in viewer's own settings.
    const [authorConfig, viewerPreset] = await Promise.all([
      video.user ? loadPreset(video.user._id, 'author') : null,
      currentUser ? loadPreset(currentUser._id, 'viewer') : null,
    ]);
    const authorTheme = authorConfig && authorConfig.theme ? authorConfig.theme : null;

    const channelVideos = video.user ? await VideoMeta.countDocuments({ user: video.user._id, hiddenAt: null }) : 0;

    res.render('player', {
      isModerator: isModerator(currentUser),
      reportReasons: REASONS,
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
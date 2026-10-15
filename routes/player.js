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
const { LISTED, isListed, canWatch } = require('../utils/visibility');
const Like = require('../schemas/Like');
const Subscription = require('../schemas/Subscription');
const Playlist = require('../schemas/Playlist');
const { playlistVideos, canSeePlaylist } = require('./library');
const { formatTime } = require('../utils/chapters');

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
    // A private video is available only to its author (and to moderators).
    if (!canWatch(currentUser, video)) {
      return res.status(404).render('error', { message: 'This video is private', error: { status: 404 }, user: currentUser });
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
      if (!isListed(video)) throw new Error('unlisted and private videos are not in the recommendation index');
      const watched = currentUser ? await recommendations.watchedBy(currentUser._id) : [];
      const ids = await recommendations.forVideo(video._id, { limit: 12, exclude: watched });
      const found = await VideoMeta.find({ _id: { $in: ids }, status: 'ready', hiddenAt: null, ...LISTED }).select(recSelect).populate('user', 'username avatarUrl').lean();
      const byId = new Map(found.map((v) => [String(v._id), v]));
      recommendedVideos = ids.map((id) => byId.get(id)).filter(Boolean);
    } catch (err) {
      if (video.status === 'ready' && isListed(video)) console.error('Recommendations failed, showing the latest videos:', err.message);
    }
    if (recommendedVideos.length < 12) {
      // Not enough recommendations (small catalogue or an error): fill up with the latest videos.
      const have = recommendedVideos.map((v) => v._id).concat(video._id);
      const latest = await VideoMeta.find({ _id: { $nin: have }, status: { $ne: 'processing' }, hiddenAt: null, ...LISTED })
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

    const channelVideos = video.user ? await VideoMeta.countDocuments({ user: video.user._id, hiddenAt: null, ...LISTED }) : 0;

    // Likes and the subscription to the channel.
    const me = currentUser ? currentUser._id : null;
    const [liked, subscribed, subscribers] = await Promise.all([
      me ? Like.exists({ user: me, video: video._id }) : null,
      me && video.user ? Subscription.exists({ subscriber: me, channel: video.user._id }) : null,
      video.user ? Subscription.countDocuments({ channel: video.user._id }) : 0,
    ]);

    // Playing a playlist (?list=...): its videos in the side panel, the next one plays after this.
    let playlist = null;
    if (req.query.list && mongoose.isValidObjectId(req.query.list)) {
      const pl = await Playlist.findById(req.query.list).populate('owner', 'username').lean();
      if (pl && canSeePlaylist(currentUser, pl)) {
        const items = await playlistVideos(currentUser, pl);
        const index = items.findIndex((v) => String(v._id) === String(video._id));
        if (index >= 0) playlist = { id: String(pl._id), title: pl.title, owner: pl.owner, items, index, next: items[index + 1] || null };
      }
    }
    const nextVideo = playlist
      ? (playlist.next ? { url: `/player/${playlist.next._id}?list=${playlist.id}`, title: playlist.next.title } : null)
      : (recommendedVideos[0] ? { url: `/player/${recommendedVideos[0]._id}`, title: recommendedVideos[0].title } : null);

    const subtitles = (video.subtitles || []).map((s) => ({ lang: s.lang, label: s.label, src: storage.getUrl(s.key) }));
    const chapters = (video.chapters || []).map((c) => ({ start: c.start, title: c.title, time: formatTime(c.start) }));

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
      recommendedVideos,
      liked: Boolean(liked),
      subscribed: Boolean(subscribed),
      subscribers,
      playlist,
      nextVideo,
      subtitles,
      chapters,
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
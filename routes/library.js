// Pages of the social functions: a channel, the subscription feed, the user's playlists and a playlist.
const express = require('express');
const mongoose = require('mongoose');
const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const Subscription = require('../schemas/Subscription');
const Playlist = require('../schemas/Playlist');
const { optionalAuth, requireAuth } = require('../utils/auth');
const { LISTED, canWatch } = require('../utils/visibility');
const { canSeeHidden } = require('../utils/moderation');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const notFound = (req, res, message = 'Not found') => res.status(404).render('error', { message, error: { status: 404 }, user: req.user || null });
const CARD = 'title user thumbnailUrl views uploadedAt duration visibility hiddenAt status';

/** Whether the viewer may open the playlist: private playlists only for the owner (and moderators). */
const canSeePlaylist = (viewer, pl) => pl.visibility !== 'private' || canSeeHidden(viewer, pl.owner && pl.owner._id ? pl.owner._id : pl.owner);

/** Videos of a playlist that the viewer may watch, in the playlist order. */
async function playlistVideos(viewer, pl) {
  const found = await VideoMeta.find({ _id: { $in: pl.videos }, status: { $ne: 'processing' } })
    .select(CARD).populate('user', 'username avatarUrl').lean();
  const byId = new Map(found.map((v) => [String(v._id), v]));
  return pl.videos.map((id) => byId.get(String(id)))
    .filter((v) => v && canWatch(viewer, v) && (!v.hiddenAt || canSeeHidden(viewer, v.user && v.user._id)));
}

// Channel page: the author's public videos and playlists, the subscribe button.
router.get('/channel/:id', optionalAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(req, res, 'Channel not found');
  const channel = await User.findById(req.params.id).select('username login avatarUrl timestamp').lean();
  if (!channel) return notFound(req, res, 'Channel not found');
  const me = req.user ? String(req.user._id) : null;
  const own = me === String(channel._id);
  const [videos, playlists, subscribers, subscribed] = await Promise.all([
    VideoMeta.find({ user: channel._id, hiddenAt: null, status: { $ne: 'processing' }, ...(own ? {} : LISTED) })
      .sort({ uploadedAt: -1 }).select(CARD).populate('user', 'username avatarUrl').lean(),
    Playlist.find({ owner: channel._id, ...(own ? {} : { visibility: 'public' }) }).sort({ updatedAt: -1 }).lean(),
    Subscription.countDocuments({ channel: channel._id }),
    me && !own ? Subscription.exists({ subscriber: me, channel: channel._id }) : null,
  ]);
  const covers = await VideoMeta.find({ _id: { $in: playlists.map((p) => p.videos[0]).filter(Boolean) } }).select('thumbnailUrl').lean();
  const coverOf = new Map(covers.map((v) => [String(v._id), v.thumbnailUrl]));
  res.render('channel', {
    title: channel.username,
    user: req.user || null,
    channel,
    own,
    videos,
    playlists: playlists.map((p) => ({ ...p, cover: p.videos[0] ? coverOf.get(String(p.videos[0])) : null })),
    subscribers,
    subscribed: Boolean(subscribed),
  });
}));

// Subscription feed: the newest public videos of the channels the user follows.
router.get('/subscriptions', requireAuth, wrap(async (req, res) => {
  const subs = await Subscription.find({ subscriber: req.user._id }).sort({ createdAt: -1 }).lean();
  const ids = subs.map((s) => s.channel);
  const [channels, videos] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('username avatarUrl').lean(),
    VideoMeta.find({ user: { $in: ids }, hiddenAt: null, status: { $ne: 'processing' }, ...LISTED })
      .sort({ uploadedAt: -1 }).limit(60).select(CARD).populate('user', 'username avatarUrl').lean(),
  ]);
  res.render('subscriptions', { title: 'Subscriptions', user: req.user, channels, videos });
}));

// The user's playlists.
router.get('/playlists', requireAuth, wrap(async (req, res) => {
  const playlists = await Playlist.find({ owner: req.user._id }).sort({ updatedAt: -1 }).lean();
  const covers = await VideoMeta.find({ _id: { $in: playlists.map((p) => p.videos[0]).filter(Boolean) } }).select('thumbnailUrl').lean();
  const coverOf = new Map(covers.map((v) => [String(v._id), v.thumbnailUrl]));
  res.render('playlists', {
    title: 'Playlists',
    user: req.user,
    playlists: playlists.map((p) => ({ ...p, cover: p.videos[0] ? coverOf.get(String(p.videos[0])) : null })),
  });
}));

// A playlist: its videos in order, "Play all", editing for the owner.
router.get('/playlist/:id', optionalAuth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(req, res, 'Playlist not found');
  const pl = await Playlist.findById(req.params.id).populate('owner', 'username avatarUrl').lean();
  if (!pl || !canSeePlaylist(req.user, pl)) return notFound(req, res, 'Playlist not found');
  const videos = await playlistVideos(req.user, pl);
  const own = Boolean(req.user && pl.owner && String(pl.owner._id) === String(req.user._id));
  res.render('playlist', { title: pl.title, user: req.user || null, playlist: pl, videos, own });
}));

module.exports = { router, playlistVideos, canSeePlaylist };

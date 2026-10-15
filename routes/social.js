// JSON API of the social functions: likes, channel subscriptions, playlists and subtitle tracks.
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const Like = require('../schemas/Like');
const Subscription = require('../schemas/Subscription');
const Playlist = require('../schemas/Playlist');
const storage = require('../utils/storage');
const { optionalAuth } = require('../utils/auth');
const { requireActiveUser } = require('../middlewares/roles');
const { VISIBILITY, canWatch } = require('../utils/visibility');
const { toWebVtt, LANGUAGES, MAX_BYTES } = require('../utils/subtitles');
const { forget: forgetMediaVisibility } = require('../middlewares/privateMedia');

const router = express.Router();

/** Express 4 does not catch rejected promises of async handlers: pass them to the error handler. */
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const validId = (id) => mongoose.isValidObjectId(id);

/** Likes, subscriptions and playlist changes: at most 120 per 10 minutes from one address. */
const actionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many actions. Try again in a few minutes.' },
});

/** A video the signed-in user may see (not hidden by moderators, not someone else's private video). */
async function visibleVideo(req, id, select = '_id user visibility hiddenAt likes') {
  if (!validId(id)) return null;
  const video = await VideoMeta.findById(id).select(select).lean();
  if (!video || video.hiddenAt || !canWatch(req.user, video)) return null;
  return video;
}

// ------------------------------------------------------------------ likes

/** Stores the number of likes of a video in its document (counted, so it never drifts) and returns it. */
async function recountLikes(videoId) {
  const likes = await Like.countDocuments({ video: videoId });
  await VideoMeta.updateOne({ _id: videoId }, { $set: { likes } });
  return likes;
}

router.post('/videos/:id/like', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const video = await visibleVideo(req, req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  try {
    await Like.create({ user: req.user._id, video: video._id });
  } catch (err) {
    if (err.code !== 11000) throw err; // already liked: nothing changes
  }
  res.json({ liked: true, likes: await recountLikes(video._id) });
}));

router.delete('/videos/:id/like', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Video not found' });
  await Like.deleteOne({ user: req.user._id, video: req.params.id });
  res.json({ liked: false, likes: await recountLikes(req.params.id) });
}));

// ------------------------------------------------------------------ subscriptions

router.post('/channels/:id/subscribe', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const id = req.params.id;
  if (!validId(id) || !(await User.exists({ _id: id }))) return res.status(404).json({ error: 'Channel not found' });
  if (String(id) === String(req.user._id)) return res.status(400).json({ error: 'You cannot subscribe to your own channel.' });
  try {
    await Subscription.create({ subscriber: req.user._id, channel: id });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  res.json({ subscribed: true, subscribers: await Subscription.countDocuments({ channel: id }) });
}));

router.delete('/channels/:id/subscribe', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ error: 'Channel not found' });
  await Subscription.deleteOne({ subscriber: req.user._id, channel: id });
  res.json({ subscribed: false, subscribers: await Subscription.countDocuments({ channel: id }) });
}));

// ------------------------------------------------------------------ playlists

const playlistFields = (body, partial = false) => {
  const out = {};
  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (!title || title.length > 100) return { error: 'The playlist name must be 1–100 characters long.' };
    out.title = title;
  }
  if (!partial || body.visibility !== undefined) {
    const visibility = body.visibility === undefined ? 'private' : body.visibility;
    if (!VISIBILITY.includes(visibility)) return { error: 'Choose who can see the playlist.' };
    out.visibility = visibility;
  }
  if (body.description !== undefined) out.description = String(body.description).trim().slice(0, 1000);
  return { values: out };
};

async function ownPlaylist(req, res) {
  if (!validId(req.params.id)) { res.status(404).json({ error: 'Playlist not found' }); return null; }
  const pl = await Playlist.findOne({ _id: req.params.id, owner: req.user._id });
  if (!pl) { res.status(404).json({ error: 'Playlist not found' }); return null; }
  return pl;
}

const card = (pl, videoId) => ({
  id: String(pl._id), title: pl.title, visibility: pl.visibility, count: pl.videos.length,
  contains: videoId ? pl.videos.some((v) => String(v) === String(videoId)) : undefined,
});

// The user's playlists (with a flag whether they contain ?video=...): the "Save" dialog.
router.get('/playlists', requireActiveUser, wrap(async (req, res) => {
  const list = await Playlist.find({ owner: req.user._id }).sort({ updatedAt: -1 }).lean();
  res.json(list.map((pl) => card(pl, req.query.video)));
}));

router.post('/playlists', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const { values, error } = playlistFields(req.body || {});
  if (error) return res.status(400).json({ error });
  if (await Playlist.countDocuments({ owner: req.user._id }) >= 200) return res.status(400).json({ error: 'You can have at most 200 playlists.' });
  const videos = [];
  if (req.body.video) {
    const video = await visibleVideo(req, req.body.video);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    videos.push(video._id);
  }
  const pl = await Playlist.create({ ...values, owner: req.user._id, videos });
  res.status(201).json(card(pl, req.body.video));
}));

router.patch('/playlists/:id', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const pl = await ownPlaylist(req, res);
  if (!pl) return;
  const { values, error } = playlistFields(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  Object.assign(pl, values, { updatedAt: new Date() });
  await pl.save();
  res.json(card(pl));
}));

router.delete('/playlists/:id', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const pl = await ownPlaylist(req, res);
  if (!pl) return;
  await pl.deleteOne();
  res.json({ ok: true });
}));

router.post('/playlists/:id/videos', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const pl = await ownPlaylist(req, res);
  if (!pl) return;
  const video = await visibleVideo(req, req.body && req.body.video);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (pl.videos.length >= 500) return res.status(400).json({ error: 'A playlist can contain at most 500 videos.' });
  if (!pl.videos.some((v) => String(v) === String(video._id))) pl.videos.push(video._id);
  pl.updatedAt = new Date();
  await pl.save();
  res.json(card(pl, video._id));
}));

router.delete('/playlists/:id/videos/:videoId', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const pl = await ownPlaylist(req, res);
  if (!pl) return;
  pl.videos = pl.videos.filter((v) => String(v) !== String(req.params.videoId));
  pl.updatedAt = new Date();
  await pl.save();
  res.json(card(pl, req.params.videoId));
}));

// Moves a video one place up or down in the playlist.
router.post('/playlists/:id/videos/:videoId/move', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  const pl = await ownPlaylist(req, res);
  if (!pl) return;
  const i = pl.videos.findIndex((v) => String(v) === String(req.params.videoId));
  const j = i + (req.body && req.body.direction === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= pl.videos.length) return res.json(card(pl));
  const list = [...pl.videos];
  [list[i], list[j]] = [list[j], list[i]];
  pl.videos = list;
  pl.updatedAt = new Date();
  await pl.save();
  res.json(card(pl));
}));

// ------------------------------------------------------------------ subtitles

const subtitleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

router.get('/subtitle-languages', (req, res) => res.json(LANGUAGES));

router.post('/videos/:id/subtitles', actionLimiter, requireActiveUser, (req, res, next) => {
  subtitleUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (1 MB at most).' : err.message });
    next();
  });
}, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Video not found' });
  const video = await VideoMeta.findOne({ _id: req.params.id, user: req.user._id });
  if (!video) return res.status(404).json({ error: 'Video not found or access denied' });
  const lang = String((req.body && req.body.lang) || '');
  if (!LANGUAGES[lang]) return res.status(400).json({ error: 'Choose the language of the subtitles.' });
  if (!req.file) return res.status(400).json({ error: 'Choose a subtitle file.' });
  const { vtt, cues, error } = toWebVtt(req.file.buffer.toString('utf8'));
  if (error) return res.status(400).json({ error });
  const key = `videos/${video.videoId}/subs/${lang}.vtt`;
  await storage.putBuffer(key, Buffer.from(vtt, 'utf8'));
  const label = String((req.body && req.body.label) || '').trim().slice(0, 40) || LANGUAGES[lang];
  video.subtitles = [...(video.subtitles || []).filter((s) => s.lang !== lang), { lang, label, key }];
  await video.save();
  forgetMediaVisibility(video.videoId);
  res.status(201).json({ ok: true, cues, subtitles: video.subtitles.map(({ lang: l, label: lb }) => ({ lang: l, label: lb })) });
}));

router.delete('/videos/:id/subtitles/:lang', actionLimiter, requireActiveUser, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Video not found' });
  const video = await VideoMeta.findOne({ _id: req.params.id, user: req.user._id });
  if (!video) return res.status(404).json({ error: 'Video not found or access denied' });
  const track = (video.subtitles || []).find((s) => s.lang === req.params.lang);
  if (track) {
    await storage.delete(track.key).catch(() => {});
    video.subtitles = video.subtitles.filter((s) => s.lang !== req.params.lang);
    await video.save();
  }
  res.json({ ok: true, subtitles: (video.subtitles || []).map(({ lang, label }) => ({ lang, label })) });
}));

// Who liked / whether the current user likes and follows: used by pages rendered from cache.
router.get('/videos/:id/state', optionalAuth, wrap(async (req, res) => {
  const video = await visibleVideo(req, req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  const me = req.user && req.user._id;
  const [liked, subscribed, subscribers] = await Promise.all([
    me ? Like.exists({ user: me, video: video._id }) : null,
    me && video.user ? Subscription.exists({ subscriber: me, channel: video.user }) : null,
    video.user ? Subscription.countDocuments({ channel: video.user }) : 0,
  ]);
  res.json({ likes: video.likes || 0, liked: Boolean(liked), subscribed: Boolean(subscribed), subscribers });
}));

module.exports = router;

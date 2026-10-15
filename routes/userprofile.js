const debug = require('../utils/debug');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');
const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const multer = require('multer');
const path = require('path');
const storage = require('../utils/storage');
const { loadPreset } = require('./presets');
const PlayerPreset = require('../schemas/PlayerPreset');
const ViewSession = require('../schemas/ViewSession');
const RefreshToken = require('../schemas/RefreshToken');
const { clearSessionCookies } = require('../utils/auth');
const { deleteVideoCompletely } = require('../utils/moderation');
const Comment = require('../schemas/CommentSchema');
const Like = require('../schemas/Like');
const Subscription = require('../schemas/Subscription');
const Playlist = require('../schemas/Playlist');
const { maxUploadText } = require('../utils/limits');
const { VISIBILITY } = require('../utils/visibility');
const { forget: forgetMediaVisibility } = require('../middlewares/privateMedia');

const CATEGORIES = ['Education', 'Entertainment'];
const { parseChapters, chaptersToText } = require('../utils/chapters');
const { LANGUAGES } = require('../utils/subtitles');

/** Validates the editable metadata of a video; returns { values } or { error, field }. */
function videoFields(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const tags = (Array.isArray(body.tags) ? body.tags.join(',') : String(body.tags || ''))
    .split(',').map((t) => t.trim()).filter(Boolean);
  if (!title || title.length > 120) return { error: 'The title must be 1–120 characters long.', field: 'title' };
  if (description.length > 2000) return { error: 'The description is too long (2000 characters at most).', field: 'description' };
  if (tags.length > 20 || tags.some((t) => t.length > 40)) return { error: 'Use at most 20 tags of up to 40 characters.', field: 'tags' };
  if (!CATEGORIES.includes(body.category)) return { error: 'Choose a category.', field: 'category' };
  if (!VISIBILITY.includes(body.visibility)) return { error: 'Choose who can see the video.', field: 'visibility' };
  return { values: { title, description, tags: [...new Set(tags)], category: body.category, visibility: body.visibility } };
}

const avatarStorage = multer.memoryStorage(); 
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 } 
});

/** Removes the media files of a video from the storage (legacy Firebase files are skipped). */
async function deleteVideoFiles(video) {
  if (!video.storageKey) return;
  try {
    await storage.deletePrefix(`videos/${video.videoId}`);
  } catch (err) {
    console.error(`Error deleting files of video ${video._id}:`, err);
  }
}


router.get('/', verifyToken, async (req, res) => {
  debug('[USERPROFILE_ROUTE_DEBUG] Entered /userprofile GET handler.');
  debug('[USERPROFILE_ROUTE_DEBUG] req.user from verifyToken:', JSON.stringify(req.user, null, 2));

  
  if (!req.user || !req.user._id) {
    debug('[USERPROFILE_ROUTE_DEBUG] req.user or req.user._id is missing after verifyToken. This should not happen. Redirecting.');
    return res.redirect('/login');
  }

  try {
   
    debug('[USERPROFILE_ROUTE_DEBUG] Attempting to find user in DB with ID:', req.user._id);
    const userFromDB = await User.findById(req.user._id).populate('videos').lean();
    
    if (!userFromDB) {
      
      debug('[USERPROFILE_ROUTE_DEBUG] User not found in DB within route handler for ID:', req.user._id, '. Clearing cookie and redirecting.');
      return res.redirect('/login');
    }
    debug('[USERPROFILE_ROUTE_DEBUG] User successfully fetched from DB in route handler.');
    debug('[USERPROFILE_ROUTE_DEBUG] userFromDB after populate, before lean (raw Mongoose doc):', userFromDB); // Log before .lean() if possible, or just the lean object
    debug('[USERPROFILE_ROUTE_DEBUG] userFromDB.videos after populate:', JSON.stringify(userFromDB ? userFromDB.videos : "userFromDB is null", null, 2));
    debug('[USERPROFILE_ROUTE_DEBUG] Type of userFromDB.videos:', userFromDB ? typeof userFromDB.videos : "userFromDB is null");
    if(userFromDB && Array.isArray(userFromDB.videos)) {
      userFromDB.videos.forEach((video, index) => {
        debug(`[USERPROFILE_ROUTE_DEBUG] Video ${index}:`, JSON.stringify(video, null, 2));
        debug(`[USERPROFILE_ROUTE_DEBUG] Video ${index} _id:`, video._id);
        debug(`[USERPROFILE_ROUTE_DEBUG] Video ${index} title:`, video.title);
        debug(`[USERPROFILE_ROUTE_DEBUG] Video ${index} thumbnailUrl:`, video.thumbnailUrl);
      });
    }

    
    if (userFromDB && !Array.isArray(userFromDB.videos)) {
      userFromDB.videos = [];
    }
    
    
    // Channel player theme editor: current theme and a video for the live preview.
    const authorConfig = await loadPreset(userFromDB._id, 'author');
    const previewVideo = userFromDB.videos.find((v) => v.status === 'ready' && v.hls && v.hls.masterKey);
    res.render('userprofile', {
      user: userFromDB,
      title: 'User Profile',
      query: req.query.q || '',
      channelTheme: (authorConfig && authorConfig.theme) || {},
      previewSrc: previewVideo ? storage.getUrl(previewVideo.hls.masterKey) : null,
      previewPoster: previewVideo ? previewVideo.thumbnailUrl : null,
      maxUploadText: maxUploadText(),
      chaptersToText,
      subtitleLanguages: LANGUAGES,
    });
  } catch (err) {
    console.error('Error loading user profile:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/avatar', verifyToken, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).send('Only images are allowed');

    const user = await User.findById(req.user._id).select('avatarUrl').lean();
    const oldKey = user && storage.keyFromUrl(user.avatarUrl);

    // A new key every time, so browsers do not show a cached old avatar.
    const key = `avatars/${req.user._id}-${Date.now()}${path.extname(req.file.originalname).toLowerCase()}`;
    await storage.putBuffer(key, req.file.buffer);
    await User.findByIdAndUpdate(req.user._id, { avatarUrl: storage.getUrl(key) });
    if (oldKey) await storage.delete(oldKey).catch(() => {});

    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error uploading avatar:', err);
    res.status(500).send('Internal Server Error');
  }
});


// Editing a published video: title, description, tags, category and visibility.
router.post('/video/:videoId/edit', verifyToken, async (req, res) => {
  try {
    const { values, error, field } = videoFields(req.body || {});
    if (error) return res.status(400).json({ error, field });
    const current = await VideoMeta.findOne({ _id: req.params.videoId, user: req.user._id }).select('duration').lean();
    if (!current) return res.status(404).json({ error: 'Video not found or access denied' });
    const ch = parseChapters(req.body.chapters, current.duration || 0);
    if (ch.error) return res.status(400).json({ error: ch.error, field: 'chapters' });
    values.chapters = ch.chapters;
    const video = await VideoMeta.findOneAndUpdate(
      { _id: req.params.videoId, user: req.user._id },
      { $set: values },
      { new: true, runValidators: true },
    ).lean();
    if (!video) return res.status(404).json({ error: 'Video not found or access denied' });
    forgetMediaVisibility(video.videoId);
    res.json({ ok: true, video: values });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Video not found' });
    console.error('Error editing video:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/video/delete/:videoId', verifyToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user._id; 

    
    const video = await VideoMeta.findOne({ _id: videoId, user: userId });

    if (!video) {
      
      return res.status(404).send('Video not found or access denied');
    }

    
    await deleteVideoCompletely(video);

    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/deleteUser', verifyToken, async (req, res) => {
  try {
    const userId = req.user._id; 

    const videosToDelete = await VideoMeta.find({ user: userId });

    for (const video of videosToDelete) {
      await deleteVideoFiles(video);
    }
    const user = await User.findById(userId).select('avatarUrl').lean();
    const avatarKey = user && storage.keyFromUrl(user.avatarUrl);
    if (avatarKey) await storage.delete(avatarKey).catch(() => {});
    // Comments of the user under any video and all comments under the user's videos.
    const videoIds = videosToDelete.map((v) => v._id);
    const ownComments = await Comment.find({ user: userId }).select('_id').lean();
    if (ownComments.length) {
      const ids = ownComments.map((c) => c._id);
      await VideoMeta.updateMany({ comments: { $in: ids } }, { $pull: { comments: { $in: ids } } });
    }
    await Comment.deleteMany({ $or: [{ user: userId }, { video: { $in: videoIds } }] });
    // Likes of the user (the counters of the liked videos are decreased), subscriptions in both
    // directions, playlists, and likes and playlist entries of the user's own videos.
    const likes = await Like.find({ user: userId }).select('video').lean();
    if (likes.length) await VideoMeta.updateMany({ _id: { $in: likes.map((l) => l.video) }, likes: { $gt: 0 } }, { $inc: { likes: -1 } });
    await Promise.all([
      Like.deleteMany({ $or: [{ user: userId }, { video: { $in: videoIds } }] }),
      Subscription.deleteMany({ $or: [{ subscriber: userId }, { channel: userId }] }),
      Playlist.deleteMany({ owner: userId }),
      Playlist.updateMany({ videos: { $in: videoIds } }, { $pull: { videos: { $in: videoIds } } }),
    ]);
    await VideoMeta.deleteMany({ user: userId });
    await PlayerPreset.deleteMany({ owner: userId });
    await ViewSession.deleteMany({ channel: userId });
    await User.findByIdAndDelete(userId);
    await RefreshToken.deleteMany({ user: userId });

    clearSessionCookies(res);
    res.redirect('/');
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

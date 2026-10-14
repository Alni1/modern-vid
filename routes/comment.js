const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const optionalVerifyToken = require('../middlewares/optionalVerifyToken');
const VideoMeta = require('../schemas/VideoMeta');
const Comment = require('../schemas/CommentSchema');
const User = require('../schemas/userSchema');
const { isBanned, isModerator, deleteCommentCompletely, log, closeReports } = require('../utils/moderation');

const MAX_LENGTH = 1000;

/** JSON API: 401 instead of a redirect to the login page. */
function requireUser(req, res, next) {
  optionalVerifyToken(req, res, () => {
    if (!req.user) return res.status(401).json({ message: 'Log in to comment.' });
    next();
  });
}

/** At most 20 comments per 10 minutes from one address. */
const postLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many comments, try again in a few minutes.' },
});

router.post('/:videoId', requireUser, postLimiter, async (req, res) => {
  if (isBanned(req.user)) return res.status(403).json({ message: 'Your account is restricted and cannot comment.' });
  const { videoId } = req.params;
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ message: 'Comment text cannot be empty.' });
  if (text.length > MAX_LENGTH) return res.status(400).json({ message: `A comment can be at most ${MAX_LENGTH} characters.` });
  if (!mongoose.isValidObjectId(videoId)) return res.status(400).json({ message: 'Invalid video ID.' });

  try {
    const video = await VideoMeta.findById(videoId).select('user hiddenAt').lean();
    if (!video || video.hiddenAt) return res.status(404).json({ message: 'Video not found.' });

    const comment = await Comment.create({ video: videoId, user: req.user._id, text });
    await Promise.all([
      VideoMeta.updateOne({ _id: videoId }, { $addToSet: { comments: comment._id } }),
      User.updateOne({ _id: req.user._id }, { $addToSet: { comments: comment._id } }),
    ]);
    res.status(201).json({
      _id: comment._id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: { _id: req.user._id, username: req.user.username, avatarUrl: req.user.avatarUrl || null },
      byAuthor: String(video.user) === String(req.user._id),
    });
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ message: 'Failed to post comment.' });
  }
});

// A comment can be deleted by its author, by the owner of the video and by moderators.
router.delete('/:commentId', requireUser, async (req, res) => {
  const { commentId } = req.params;
  if (!mongoose.isValidObjectId(commentId)) return res.status(404).json({ message: 'Comment not found.' });
  try {
    const comment = await Comment.findById(commentId).lean();
    if (!comment) return res.status(404).json({ message: 'Comment not found.' });
    const video = await VideoMeta.findById(comment.video).select('user').lean();
    const me = String(req.user._id);
    const own = String(comment.user) === me || (video && String(video.user) === me);
    if (!own && !isModerator(req.user)) return res.status(403).json({ message: 'You cannot delete this comment.' });
    if (!own) {
      // A moderator deletes someone else's comment: recorded in the moderation log.
      await closeReports('comment', comment._id, req.user, 'deleted');
      await log(req.user, 'delete', 'comment', comment._id, { label: comment.text });
    }
    await deleteCommentCompletely(comment);
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ message: 'Failed to delete comment.' });
  }
});

module.exports = router;

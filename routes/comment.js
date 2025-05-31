const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const verifyToken = require('../middlewares/verifyToken'); // Middleware for authentication
const VideoMeta = require('../schemas/VideoMeta');
const Comment = require('../schemas/CommentSchema');
const User = require('../schemas/userSchema');

// POST a new comment to a video
// Path: /comments/:videoId
router.post('/:videoId', verifyToken, async (req, res) => {
  const { videoId } = req.params;
  const { text } = req.body;
  const userId = req.user._id; // Corrected to use _id from the Mongoose document

  if (!text || text.trim() === '') {
    return res.status(400).json({ message: 'Comment text cannot be empty.' });
  }

  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    return res.status(400).json({ message: 'Invalid video ID.' });
  }

  try {
    const video = await VideoMeta.findById(videoId);
    if (!video) {
      return res.status(404).json({ message: 'Video not found.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const newComment = new Comment({
      video: videoId,
      user: userId,
      text: text
    });

    await newComment.save();

    // Add comment to video's comments array using $addToSet to prevent duplicates
    await VideoMeta.findByIdAndUpdate(videoId, { $addToSet: { comments: newComment._id } });

    // Add comment to user's comments array using $addToSet
    await User.findByIdAndUpdate(userId, { $addToSet: { comments: newComment._id } });
    
    // Populate user details for the comment to send back to client
    const populatedComment = await Comment.findById(newComment._id).populate('user', 'username avatarUrl');

    res.status(201).json(populatedComment);

  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ message: 'Failed to post comment.', error: error.message });
  }
});

module.exports = router;
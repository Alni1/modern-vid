const mongoose = require('mongoose');

// "Like" of a video: one document per viewer and video (the counter is kept in VideoMeta.likes).
const likeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoMeta', required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'likes' });

likeSchema.index({ user: 1, video: 1 }, { unique: true });
likeSchema.index({ video: 1 });

module.exports = mongoose.model('Like', likeSchema);

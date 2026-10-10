const mongoose = require('mongoose');

const videoMetaSchema = new mongoose.Schema({
  videoId: { type: String, required: true, unique: true },
  title: String,
  description: String,
  tags: [String],
  uploadedAt: { type: Date, default: Date.now },
  size: Number,
  duration: Number,
  contentType: String,
  // Where the media lives. storageKey is the key of the source file in the storage driver.
  storageDriver: String,
  storageKey: String,
  thumbnailKey: String,
  // Legacy: videos uploaded to Firebase Storage by the first version of the platform.
  firebasePath: String,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  views: { type: Number, default: 0 },
  thumbnailUrl: { type: String },
  category: {
    type: String,
    enum: ['Education', 'Entertainment'],
    required: true
  },
  comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }]
}, {
  collection: 'videoMeta'
});

module.exports = mongoose.model('VideoMeta', videoMetaSchema);
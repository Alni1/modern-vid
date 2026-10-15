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
  // Processing state of an upload: transcoding into HLS renditions runs in the background.
  status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'ready' },
  processingProgress: { type: Number, default: 0 },
  processingError: String,
  // WebVTT with seek-bar preview frames (sprite sheets next to it).
  previewsKey: String,
  hls: {
    masterKey: String,
    renditions: [{ _id: false, name: String, width: Number, height: Number, fps: Number, videoKbps: Number, audioKbps: Number }],
  },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  views: { type: Number, default: 0 },
  // Hidden by a moderator: visible only to the author (with the reason) and to moderators.
  hiddenAt: { type: Date, default: null },
  hiddenReason: { type: String, default: '' },
  thumbnailUrl: { type: String },
  // Who can find and open the video: public, unlisted (by link only) or private (author only).
  visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'public' },
  // Number of likes (the likes themselves are in the Like collection).
  likes: { type: Number, default: 0 },
  // Chapters set by the author: start time (s) and title, sorted by time.
  chapters: [{ _id: false, start: Number, title: String }],
  // Subtitle tracks (WebVTT files in the storage), one per language.
  subtitles: [{ _id: false, lang: String, label: String, key: String }],
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
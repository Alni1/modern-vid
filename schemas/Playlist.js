const mongoose = require('mongoose');

// A list of videos made by a user; the order of `videos` is the playing order.
const playlistSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 1000 },
  // Same levels as for videos: public, unlisted (by link) or private (owner only).
  visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'private' },
  videos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VideoMeta' }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'playlists' });

playlistSchema.index({ videos: 1 });

module.exports = mongoose.model('Playlist', playlistSchema);

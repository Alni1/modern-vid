const mongoose = require('mongoose');

/**
 * One viewing session of a video (one page load of the watch page).
 * The watch page reports it periodically; reports of the same session are merged:
 * watch time only grows, watched parts of the video are a union of 1 % buckets.
 */
const viewSessionSchema = new mongoose.Schema({
  session: { type: String, required: true, unique: true },
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoMeta', required: true },
  // Owner of the video, denormalized so channel statistics need no join.
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  viewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Seconds of actual playback (pauses, stalls and seeks excluded; rewatching counts).
  watched: { type: Number, default: 0 },
  // Indexes 0..99 of the 1 % parts of the video that were played (for audience retention).
  buckets: { type: [Number], default: [] },
  // The session counts as a view once enough of the video was played (see utils/analytics.js).
  counted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'viewSessions', versionKey: false });

viewSessionSchema.index({ channel: 1, createdAt: 1 });
viewSessionSchema.index({ video: 1, createdAt: 1 });
viewSessionSchema.index({ viewer: 1, createdAt: -1 });

module.exports = mongoose.model('ViewSession', viewSessionSchema);

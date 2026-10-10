const mongoose = require('mongoose');

/** A background job that transcodes an uploaded video into HLS renditions. */
const transcodeJobSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoMeta', required: true, index: true },
  status: { type: String, enum: ['queued', 'processing', 'done', 'failed'], default: 'queued', index: true },
  attempts: { type: Number, default: 0 },
  progress: { type: Number, default: 0 },
  error: String,
  lockedAt: Date,
  finishedAt: Date,
}, { timestamps: true, collection: 'transcodeJobs' });

module.exports = mongoose.model('TranscodeJob', transcodeJobSchema);

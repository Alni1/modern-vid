const mongoose = require('mongoose');

/** A complaint about a video or a comment. One user can report one object once. */
const reportSchema = new mongoose.Schema({
  targetType: { type: String, enum: ['video', 'comment'], required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  // Author of the reported object (to see repeated offenders and to ban from the queue).
  targetOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, enum: ['spam', 'abuse', 'inappropriate', 'copyright', 'other'], required: true },
  note: { type: String, maxlength: 500, default: '' },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  // What the moderator did: hidden, deleted, dismissed, or the object no longer exists.
  action: { type: String, default: '' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'reports', versionKey: false });

reportSchema.index({ targetType: 1, target: 1, reporter: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('Report', reportSchema);

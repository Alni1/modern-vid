const mongoose = require('mongoose');

/** Journal of moderator and administrator actions (who did what, when and why). */
const moderationLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: {
    type: String,
    required: true,
    enum: ['hide', 'unhide', 'delete', 'dismiss', 'ban', 'unban', 'role'],
  },
  targetType: { type: String, enum: ['video', 'comment', 'user'], required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  // Title, comment text or login at the time of the action: the object itself may be deleted later.
  targetLabel: { type: String, default: '' },
  reason: { type: String, default: '' },
  // Action details, e.g. the ban end or the new role.
  details: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'moderationLog', versionKey: false });

moderationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ModerationLog', moderationLogSchema);

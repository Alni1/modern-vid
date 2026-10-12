const mongoose = require('mongoose');

/**
 * Player settings preset.
 *   scope "viewer" — a viewer's own settings (any configuration group);
 *   scope "author" — the look of a channel's player (theme group only).
 * Only the values that differ from the player defaults are stored in `config`.
 */
const playerPresetSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scope: { type: String, enum: ['viewer', 'author'], required: true },
    name: { type: String, trim: true, maxlength: 60, default: 'My settings' },
    config: { type: Object, default: {} },
    schemaVersion: { type: Number, default: 1 },
    isDefault: { type: Boolean, default: true },
    shareCode: { type: String, index: { unique: true, sparse: true } },
  },
  { timestamps: true, collection: 'playerpresets', minimize: false },
);

// One default preset per user and scope.
playerPresetSchema.index({ owner: 1, scope: 1, isDefault: 1 });

module.exports = mongoose.model('PlayerPreset', playerPresetSchema);

const mongoose = require('mongoose');

/**
 * Refresh token of a sign-in session. Only the SHA-256 hash of the token is stored, so a
 * leaked database does not give working tokens. Each use replaces the token with a new one
 * (rotation); all tokens issued from one sign-in share a `family`.
 */
const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  hash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  // Set when the token was exchanged for a new one (rotation).
  rotatedAt: { type: Date, default: null },
  // Set on all tokens of the family when the session ends (sign-out, sign-out everywhere, theft).
  endedAt: { type: Date, default: null },
  // Short description of the device (browser user agent), shown nowhere yet; helps when debugging.
  userAgent: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'refreshTokens', versionKey: false });

// MongoDB removes tokens automatically once they expire.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);

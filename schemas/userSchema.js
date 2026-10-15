const debug = require('../utils/debug');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const uuidv7 = require('uuidv7');

const Schema = mongoose.Schema;

let userSchema = new mongoose.Schema({
  uuid: { type: String, unique: true }, 
  login: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true, minlength: 8, trim: true }, 
  username: { type: String, required: true },
  timestamp: { type: Date }, 

  avatarUrl: { type: String, default: null },

  // Moderation: role of the account and a temporary restriction (no uploads, comments or reports).
  role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },
  bannedUntil: { type: Date, default: null },
  banReason: { type: String, default: '' },
  // Access tokens issued before this moment are rejected (sign-out everywhere, restriction).
  sessionsRevokedAt: { type: Date, default: null },

  videos: [{ type: Schema.Types.ObjectId, ref: 'VideoMeta' }],
  comments: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],
  video_ids: { type: Array, required: false }, 
}, {
  collection: 'userData'
});

userSchema.pre("save", async function (next) {
  const user = this;
  debug('[USER_SCHEMA_PRE_SAVE] Entered pre-save hook for user:', user.login);

  if (!user.uuid) {
    user.uuid = uuidv7.uuidv7();
    debug('[USER_SCHEMA_PRE_SAVE] Generated uuid:', user.uuid);
  }

  if (!user.timestamp) {
    user.timestamp = new Date();
    debug('[USER_SCHEMA_PRE_SAVE] Generated timestamp:', user.timestamp);
  }

  if (user.isModified("password") || user.isNew) {
    if (user.password && user.password.length >= 6) {
        debug('[USER_SCHEMA_PRE_SAVE] Hashing password for user:', user.login);
        user.password = await bcrypt.hash(user.password, 10);
    } else if (user.isNew && (!user.password || user.password.length < 8)) {

        debug('[USER_SCHEMA_PRE_SAVE] Password for new user does not meet length requirement, will let schema validation handle it.');
    }
  }

  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;

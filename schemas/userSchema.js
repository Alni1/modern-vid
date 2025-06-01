const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jsonWT = require('jsonwebtoken');
const uuidv7 = require('uuidv7');

const Schema = mongoose.Schema;

let userSchema = new mongoose.Schema({
  uuid: { type: String, unique: true }, 
  login: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true, minlength: 6, trim: true }, 
  username: { type: String, required: true },
  timestamp: { type: Date }, 
  JWT: { type: String, unique: true },  

  avatarUrl: { type: String, default: null },

  videos: [{ type: Schema.Types.ObjectId, ref: 'VideoMeta' }],
  comments: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],
  video_ids: { type: Array, required: false }, 
}, {
  collection: 'userData'
});

userSchema.pre("save", async function (next) {
  const user = this;
  console.log('[USER_SCHEMA_PRE_SAVE] Entered pre-save hook for user:', user.login);

  if (!user.uuid) {
    user.uuid = uuidv7.uuidv7();
    console.log('[USER_SCHEMA_PRE_SAVE] Generated uuid:', user.uuid);
  }

  if (!user.timestamp) {
    user.timestamp = new Date();
    console.log('[USER_SCHEMA_PRE_SAVE] Generated timestamp:', user.timestamp);
  }

  if (user.isModified("password") || user.isNew) {
    if (user.password && user.password.length >= 6) { // Добавим проверку длины перед хешированием
        console.log('[USER_SCHEMA_PRE_SAVE] Hashing password for user:', user.login);
        user.password = await bcrypt.hash(user.password, 8);
    } else if (user.isNew && (!user.password || user.password.length < 6)) {

        console.log('[USER_SCHEMA_PRE_SAVE] Password for new user does not meet length requirement, will let schema validation handle it.');
    }
  }

  if (user.uuid && user.login) {
    
    const payload = {
      id: user.uuid, 
      login: user.login
    };
    console.log('[USER_SCHEMA_PRE_SAVE] Generating JWT with payload:', payload);
    console.log('[USER_SCHEMA_PRE_SAVE] SECRET_KEY for JWT:', process.env.SECRET_KEY ? 'Exists' : 'MISSING!');
    if (process.env.SECRET_KEY) {
        user.JWT = jsonWT.sign(payload, process.env.SECRET_KEY);
        console.log('[USER_SCHEMA_PRE_SAVE] Generated JWT:', user.JWT ? 'Success' : 'Failed or Undefined');
    } else {
        console.error('[USER_SCHEMA_PRE_SAVE] SECRET_KEY is missing. Cannot generate JWT.');

    }
  } else {
    console.error('[USER_SCHEMA_PRE_SAVE] Cannot generate JWT due to missing uuid or login for user:', user.login);
  }

  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;

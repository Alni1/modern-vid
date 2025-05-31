const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jsonWT = require('jsonwebtoken');
const uuidv7 = require('uuidv7');

const Schema = mongoose.Schema;

let userSchema = new mongoose.Schema({
  uuid: { type: String, unique: true }, // Убрали required, генерируется в pre('save')
  login: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true, minlength: 6, trim: true }, // Убрали default, чтобы не было путаницы
  username: { type: String, required: true },
  timestamp: { type: Date }, // Убрали required, генерируется в pre('save')
  JWT: { type: String, unique: true },  // Убрали required, генерируется в pre('save')

  // Добавляем поле аватарки (URL на Firebase Storage)
  avatarUrl: { type: String, default: null },

  // Добавляем массив видео (ссылки на VideoMeta _id)
  videos: [{ type: Schema.Types.ObjectId, ref: 'VideoMeta' }],
  comments: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],
  video_ids: { type: Array, required: false }, // если нужно, можно убрать или заменить
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
        // Если это новый пользователь и пароль не соответствует требованиям,
        // можно либо выбросить ошибку, либо не хешировать, и валидация minlength сработает.
        // Оставим как есть, чтобы валидация minlength сработала, если пароль короткий.
        console.log('[USER_SCHEMA_PRE_SAVE] Password for new user does not meet length requirement, will let schema validation handle it.');
    }
  }

  // Генерация JWT
  // Убедимся, что user.uuid и user.login существуют (они должны быть к этому моменту)
  if (user.uuid && user.login) {
    // Для JWT payload используем id, который будет присвоен MongoDB, если это обновление,
    // или uuid, если это новый документ (так как _id еще нет).
    // Однако, для консистентности и так как JWT используется для идентификации сессии,
    // лучше всегда использовать user._id, если он есть, или user.uuid.
    // В verifyToken мы используем decoded.id, который должен соответствовать тому, что здесь.
    // При регистрации user._id еще нет. Поэтому используем user.uuid.
    // При логине, когда мы создаем токен, мы используем user._id.
    // Это нужно унифицировать. Пока оставим user.uuid для регистрации.
    const payload = {
      id: user.uuid, // Используем uuid, так как _id еще может не быть у нового документа
      login: user.login
    };
    console.log('[USER_SCHEMA_PRE_SAVE] Generating JWT with payload:', payload);
    console.log('[USER_SCHEMA_PRE_SAVE] SECRET_KEY for JWT:', process.env.SECRET_KEY ? 'Exists' : 'MISSING!');
    if (process.env.SECRET_KEY) {
        user.JWT = jsonWT.sign(payload, process.env.SECRET_KEY);
        console.log('[USER_SCHEMA_PRE_SAVE] Generated JWT:', user.JWT ? 'Success' : 'Failed or Undefined');
    } else {
        console.error('[USER_SCHEMA_PRE_SAVE] SECRET_KEY is missing. Cannot generate JWT.');
        // Это приведет к ошибке валидации, если JWT был бы required.
        // Сейчас JWT не required, но это плохое состояние.
    }
  } else {
    console.error('[USER_SCHEMA_PRE_SAVE] Cannot generate JWT due to missing uuid or login for user:', user.login);
  }

  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;

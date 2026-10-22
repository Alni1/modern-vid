// Load .env before any module reads process.env (e.g. FFMPEG_PATH in the transcoder).
require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var mongoose = require('mongoose');
const storage = require('./utils/storage');
const { startWorker } = require('./utils/transcoder/worker');
const { migrateLegacyAuth } = require('./utils/auth');
const { sanitize } = require('./middlewares/sanitize');
const { privateMedia } = require('./middlewares/privateMedia');



const logoutRouter = require('./routes/logout');
var RateLimit = require('express-rate-limit');
var limiter = RateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // per IP per 15 min; page views, status polling and API calls all count
});

var indexRouter = require('./routes/index');
const playerRouter = require('./routes/player');

const uploadRouter = require('./routes/upload');
const searchRouter = require('./routes/search');
const userProfileRouter = require('./routes/userprofile');
const commentRouter = require('./routes/comment'); 
const presetsRouter = require('./routes/presets');
const analyticsRouter = require('./routes/analytics');
const reportsRouter = require('./routes/reports');
const accountRouter = require('./routes/account');
const moderation = require('./routes/moderation');
const socialRouter = require('./routes/social');
const library = require('./routes/library');


var usersRouter = require('./routes/users');
var registrationRouter = require('./routes/registration');
var loginRouter = require('./routes/login');

mongoose.connect(process.env.MONGODB_URL)
.then(async () => {
  console.log('MongoDB connected');
  await migrateLegacyAuth().catch((err) => console.warn('[auth] migration failed:', err.message));
  return startWorker();
})
.catch((err) => console.error('MongoDB connection error:', err));
var app = express();
// Behind a reverse proxy or tunnel (Cloudflare Tunnel, nginx) the client address comes from
// X-Forwarded-For: TRUST_PROXY=loopback (tunnel on the same machine) or the number of proxies.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(sanitize); // no MongoDB operators in request data
app.use(express.static(path.join(__dirname, 'public')));
// Media files (videos, thumbnails, avatars): served from the local folder, or proxied/redirected
// to the S3 bucket. Registered before the rate limiter: a single playback issues many requests.
app.use('/media', privateMedia, storage.middleware());
app.use(limiter);

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/registration', registrationRouter);
app.use('/login', loginRouter);
app.use('/player', playerRouter);

app.use('/upload', uploadRouter);   // ← added
app.use('/search', searchRouter);
app.use('/userprofile', userProfileRouter); // user profile route
app.use('/comments', commentRouter); // Use comment router
app.use('/api/presets', presetsRouter); // player settings: viewer presets and channel themes
app.use('/api/analytics', analyticsRouter); // watch reports and channel statistics
app.use('/api/reports', reportsRouter); // complaints about videos and comments
app.use('/api/account', accountRouter); // display name, login and password of the signed-in user
app.use('/api/moderation', moderation.api); // moderation API (moderators and administrators)
app.use('/moderation', moderation.page); // moderation panel
app.use('/api', socialRouter); // likes, subscriptions, playlists, subtitles
app.use('/', library.router); // channel, subscriptions, playlists pages
app.use('/logout', logoutRouter);
// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // API requests get JSON; internal details are not shown to users in production.
  const message = status >= 500 && req.app.get('env') !== 'development' ? 'Server error' : err.message;
  res.status(status);
  if (req.originalUrl.startsWith('/api/')) return res.json({ error: message });
  res.locals.message = message;
  res.render('error');
});

module.exports = app; // Export only the app instance
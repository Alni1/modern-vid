// Load .env before any module reads process.env (e.g. FFMPEG_PATH in the transcoder).
require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var mongoose = require('mongoose');
const storage = require('./utils/storage');
const { startWorker } = require('./utils/transcoder/worker');



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


var usersRouter = require('./routes/users');
var registrationRouter = require('./routes/registration');
var loginRouter = require('./routes/login');
const { validateHeaderName } = require('http');

mongoose.connect(process.env.MONGODB_URL)
.then(() => {
  console.log('MongoDB connected');
  return startWorker();
})
.catch((err) => console.error('MongoDB connection error:', err));
var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
// Media files (videos, thumbnails, avatars) from the local storage driver.
// Registered before the rate limiter: a single video playback issues many range requests.
if (storage.name === 'local') app.use('/media', storage.middleware());
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

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app; // Export only the app instance
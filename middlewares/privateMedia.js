// Media files of private videos (/media/videos/<videoId>/...) are served only to the author
// and to moderators. The visibility of a video is cached for a short time, because the player
// requests many segments of the same video.
const VideoMeta = require('../schemas/VideoMeta');
const { optionalAuth } = require('../utils/auth');
const { canWatch } = require('../utils/visibility');

const TTL_MS = 30 * 1000;
const cache = new Map(); // videoId -> { video, at }

async function lookup(videoId) {
  const hit = cache.get(videoId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.video;
  const video = await VideoMeta.findOne({ videoId }).select('visibility user').lean();
  if (cache.size > 5000) cache.clear();
  cache.set(videoId, { video, at: Date.now() });
  return video;
}

/** Forgets the cached visibility (called after the author changes it). */
const forget = (videoId) => cache.delete(videoId);

function privateMedia(req, res, next) {
  const m = /^\/videos\/([^/]+)\//.exec(req.path);
  if (!m) return next();
  lookup(m[1]).then((video) => {
    if (!video || video.visibility !== 'private') return next();
    optionalAuth(req, res, (err) => {
      if (err) return next(err);
      if (canWatch(req.user, video)) return next();
      res.status(404).send('Not found');
    });
  }, next);
}

module.exports = { privateMedia, forget };

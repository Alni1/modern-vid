// Recommendation service: builds "Up next" lists for all videos from the catalogue and the
// watch analytics, keeps them in memory and rebuilds them in the background every few minutes.
const VideoMeta = require('../schemas/VideoMeta');
const ViewSession = require('../schemas/ViewSession');
const { recommendAll } = require('./recommend');

const TTL = 10 * 60 * 1000; // rebuild at most every 10 minutes
const STATS_DAYS = 90; // watched share from the views of the last 90 days
const VIEWERS_DAYS = 180; // co-watching from the last 180 days
const POPULAR_DAYS = 7;

let cache = null; // { byVideo: Map, popular: [{ id, watched, views }], builtAt }
let building = null;

const daysAgo = (d) => new Date(Date.now() - d * 86400000);

async function build() {
  const t0 = Date.now();
  const [videos, statRows, viewerRows, popularRows] = await Promise.all([
    VideoMeta.find({ status: 'ready', hiddenAt: null }).select('title description tags category user uploadedAt').lean(),
    // Views and the sum of watched shares (buckets / 100) per video.
    ViewSession.aggregate([
      { $match: { counted: true, createdAt: { $gte: daysAgo(STATS_DAYS) } } },
      { $group: { _id: '$video', views: { $sum: 1 }, buckets: { $sum: { $size: '$buckets' } } } },
    ]),
    // Signed-in viewers of every video (for co-watching).
    ViewSession.aggregate([
      { $match: { counted: true, viewer: { $ne: null }, createdAt: { $gte: daysAgo(VIEWERS_DAYS) } } },
      { $group: { _id: '$video', viewers: { $addToSet: '$viewer' } } },
    ]),
    // Popular this week: by watch time, not by the number of page openings.
    ViewSession.aggregate([
      { $match: { createdAt: { $gte: daysAgo(POPULAR_DAYS) } } },
      { $group: { _id: '$video', watched: { $sum: '$watched' }, views: { $sum: { $cond: ['$counted', 1, 0] } } } },
      { $match: { views: { $gt: 0 } } },
      { $sort: { watched: -1 } },
      { $limit: 50 },
    ]),
  ]);
  const stats = new Map(statRows.map((r) => [String(r._id), { views: r.views, parts: r.buckets / 100 }]));
  const viewers = new Map(viewerRows.map((r) => [String(r._id), new Set(r.viewers.map(String))]));
  const byVideo = recommendAll(videos, { stats, viewers, limit: 24 });
  const ready = new Set(videos.map((v) => String(v._id)));
  const popular = popularRows.filter((r) => ready.has(String(r._id))).map((r) => ({ id: String(r._id), watched: r.watched, views: r.views }));
  cache = { byVideo, popular, builtAt: Date.now() };
  console.log(`[recommendations] built for ${videos.length} videos in ${Date.now() - t0} ms`);
  return cache;
}

/** Current lists; rebuilt in the background when older than TTL (or right away when missing). */
async function current({ needVideo } = {}) {
  const stale = !cache || Date.now() - cache.builtAt > TTL || (needVideo && !cache.byVideo.has(String(needVideo)));
  if (stale && !building) {
    building = build().catch((err) => {
      console.error('[recommendations] build failed:', err.message);
      return cache;
    }).finally(() => { building = null; });
  }
  // A new video (not in the lists yet) and the very first request wait for the build.
  if (!cache || (needVideo && !cache.byVideo.has(String(needVideo)))) await building;
  return cache;
}

/** Ids of recommended videos for a video, without the excluded ids. */
async function forVideo(videoId, { limit = 12, exclude = [] } = {}) {
  const c = await current({ needVideo: videoId });
  const skip = new Set(exclude.map(String));
  return ((c && c.byVideo.get(String(videoId))) || []).filter((r) => !skip.has(r.id)).slice(0, limit).map((r) => r.id);
}

/** Ids of the most watched videos of the last week. */
async function popular(limit = 8) {
  const c = await current();
  return c ? c.popular.slice(0, limit).map((r) => r.id) : [];
}

/** Videos the signed-in viewer has watched almost completely (≥ 90 %), most recent first. */
async function watchedBy(viewerId) {
  if (!viewerId) return [];
  const rows = await ViewSession.find({ viewer: viewerId, counted: true })
    .sort({ createdAt: -1 }).limit(300).select('video buckets').lean();
  return [...new Set(rows.filter((r) => r.buckets.length >= 90).map((r) => String(r.video)))];
}

module.exports = { forVideo, popular, watchedBy, build };

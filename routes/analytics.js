// Watch analytics: reports from the watch page and statistics for channel authors.
const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { authenticate, requireAuth } = require('../utils/auth');
const VideoMeta = require('../schemas/VideoMeta');
const ViewSession = require('../schemas/ViewSession');
const {
  TIME_ZONE, viewThreshold, parseReport, acceptedWatched, buildDaily, retentionCurve, parsePeriod,
  dailyPipeline, perVideoPipeline, retentionPipeline,
} = require('../utils/analytics');

const router = express.Router();

/** The watch page reports every 15 s; this leaves room for several tabs per viewer. */
const reportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

const requireUser = requireAuth;

// ---- reports from the watch page -------------------------------------------

router.post('/session', reportLimiter, async (req, res) => {
  const report = parseReport(req.body);
  if (!report) return res.status(400).json({ error: 'Malformed report' });
  try {
    const video = await VideoMeta.findById(report.video).select('user duration').lean();
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (!video.user) return res.status(204).end(); // videos without an owner have no analytics

    const now = new Date();
    const existing = await ViewSession.findOne({ session: report.session }).select('video watched counted updatedAt').lean();
    if (existing && String(existing.video) !== report.video) return res.status(409).json({ error: 'Session belongs to another video' });

    // The first report comes at most 15 s after playback starts; allow two minutes for it.
    const elapsed = existing ? (now - existing.updatedAt) / 1000 : 120;
    const watched = acceptedWatched(report.watched, existing && existing.watched, elapsed, video.duration);
    const counted = Boolean(existing && existing.counted) || watched >= viewThreshold(video.duration);

    // The viewer is only needed when the session is created.
    const viewer = existing ? null : ((await authenticate(req, res)) || {})._id || null;
    await ViewSession.updateOne(
      { session: report.session },
      {
        $setOnInsert: { video: video._id, channel: video.user, viewer, createdAt: now },
        $set: { watched, counted, updatedAt: now },
        $addToSet: { buckets: { $each: report.buckets } },
      },
      { upsert: true },
    );
    res.status(204).end();
  } catch (err) {
    // Two reports of a new session at the same moment: the second one loses the upsert race.
    if (err && err.code === 11000) return res.status(204).end();
    console.error('Analytics report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- statistics for the author ---------------------------------------------

/** Daily series of the period with zero days filled in, and totals of the previous period. */
async function daily(match, days, now) {
  return buildDaily(await ViewSession.aggregate(dailyPipeline(match, days, now)), days, now);
}

router.get('/channel', requireUser, async (req, res) => {
  try {
    const days = parsePeriod(req.query.days);
    const now = new Date();
    const channel = req.user._id;
    const [series, perVideo, videos] = await Promise.all([
      daily({ channel }, days, now),
      ViewSession.aggregate(perVideoPipeline(channel, days, now)),
      VideoMeta.find({ user: channel }).select('title thumbnailUrl duration uploadedAt status').sort({ uploadedAt: -1 }).lean(),
    ]);
    const stats = new Map(perVideo.map((v) => [String(v._id), v]));
    const list = videos.map((v) => {
      const s = stats.get(String(v._id));
      return {
        id: String(v._id),
        title: v.title,
        thumbnailUrl: v.thumbnailUrl || null,
        duration: v.duration || 0,
        uploadedAt: v.uploadedAt,
        status: v.status,
        views: s ? s.views : 0,
        watched: s ? s.watched : 0,
        avgPercent: s && s.parts != null ? s.parts : null,
      };
    }).sort((a, b) => b.views - a.views || b.watched - a.watched);
    res.json({ days, timeZone: TIME_ZONE, ...series, videos: list });
  } catch (err) {
    console.error('Channel analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/video/:id', requireUser, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Video not found' });
    const video = await VideoMeta.findById(req.params.id).select('title duration user thumbnailUrl uploadedAt').lean();
    if (!video || String(video.user) !== String(req.user._id)) return res.status(404).json({ error: 'Video not found' });
    const days = parsePeriod(req.query.days);
    const now = new Date();
    const match = { video: video._id };
    const [series, [ret]] = await Promise.all([
      daily(match, days, now),
      ViewSession.aggregate(retentionPipeline(video._id, days, now)),
    ]);
    const total = ret.total[0] ? ret.total[0].n : 0;
    res.json({
      days,
      timeZone: TIME_ZONE,
      video: { id: String(video._id), title: video.title, duration: video.duration || 0, thumbnailUrl: video.thumbnailUrl || null },
      ...series,
      avgViewDuration: ret.avg[0] ? ret.avg[0].watched : 0,
      avgPercent: ret.avg[0] ? ret.avg[0].parts : null,
      retention: retentionCurve(ret.buckets, total),
    });
  } catch (err) {
    console.error('Video analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

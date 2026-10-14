const express = require('express');
const router = express.Router();
const optionalVerifyToken = require('../middlewares/optionalVerifyToken');
const VideoMeta = require('../schemas/VideoMeta');
const recommendations = require('../utils/recommendations');

/** "Popular this week" is shown once at least this many videos were watched in the last 7 days. */
const POPULAR_MIN = 3;

router.get('/', optionalVerifyToken, async function (req, res) {
  const user = req.user || null;
  let videos = [];
  let popular = [];
  try {
    const [latest, popularIds] = await Promise.all([
      VideoMeta.find({ status: { $ne: 'processing' }, hiddenAt: null })
        .sort({ uploadedAt: -1 })
        .populate('user', 'username avatarUrl')
        .lean(),
      recommendations.popular(8).catch((err) => {
        console.error('Popular videos failed:', err.message);
        return [];
      }),
    ]);
    videos = latest;
    if (popularIds.length >= POPULAR_MIN) {
      const byId = new Map(latest.map((v) => [String(v._id), v]));
      popular = popularIds.map((id) => byId.get(id)).filter(Boolean);
    }
  } catch (err) {
    console.error('Error loading videos:', err.message);
  }
  res.render('index', { title: 'ModernVid', user, videos, popular });
});

module.exports = router;

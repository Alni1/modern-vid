// Reports (complaints) about videos and comments, sent by signed-in users.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireActiveUser } = require('../middlewares/roles');
const VideoMeta = require('../schemas/VideoMeta');
const Comment = require('../schemas/CommentSchema');
const Report = require('../schemas/Report');
const { parseReport } = require('../utils/moderation');

const router = express.Router();

/** At most 20 reports per hour from one address. */
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many reports, try again later.' },
});

router.post('/', requireActiveUser, reportLimiter, async (req, res) => {
  const report = parseReport(req.body);
  if (!report) return res.status(400).json({ message: 'Choose what is wrong with it.' });
  try {
    const target = report.targetType === 'video'
      ? await VideoMeta.findById(report.target).select('user').lean()
      : await Comment.findById(report.target).select('user').lean();
    if (!target) return res.status(404).json({ message: 'It no longer exists.' });
    if (String(target.user) === String(req.user._id)) return res.status(400).json({ message: 'You cannot report your own content.' });

    // One report per user and object. Repeating it while it is open updates the reason;
    // a report that moderators have already handled is not reopened.
    const key = { targetType: report.targetType, target: report.target, reporter: req.user._id };
    const existing = await Report.findOne(key).select('status').lean();
    if (!existing) {
      await Report.create({ ...key, reason: report.reason, note: report.note, targetOwner: target.user || null });
    } else if (existing.status === 'open') {
      await Report.updateOne({ _id: existing._id }, { $set: { reason: report.reason, note: report.note } });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Error saving a report:', err);
    res.status(500).json({ message: 'Could not send the report.' });
  }
});

module.exports = router;

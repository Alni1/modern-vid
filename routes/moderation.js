// Moderation panel (/moderation) and its API (/api/moderation): reports queue, hiding and deleting
// content, restricting users, roles and the journal of moderator actions.
const express = require('express');
const mongoose = require('mongoose');
const _ = require('lodash');
const { requireModerator, requireAdmin } = require('../middlewares/roles');
const VideoMeta = require('../schemas/VideoMeta');
const Comment = require('../schemas/CommentSchema');
const User = require('../schemas/userSchema');
const Report = require('../schemas/Report');
const ModerationLog = require('../schemas/ModerationLog');
const { signOutEverywhere } = require('../utils/auth');
const M = require('../utils/moderation');

const page = express.Router();
const api = express.Router();

// Express 4 does not catch rejected promises of async handlers: pass the errors to next().
for (const method of ['get', 'post']) {
  const register = api[method].bind(api);
  api[method] = (path, ...handlers) => register(path, ...handlers.map((fn) => (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  }));
}

page.get('/', requireModerator, (req, res) => {
  res.render('moderation', {
    title: 'Moderation',
    user: req.user,
    isAdmin: M.isAdmin(req.user),
    reasons: M.REASONS,
    banDays: M.BAN_DAYS,
  });
});

api.use(requireModerator);

const ids = (list) => [...new Set(list.filter(Boolean).map(String))];
const userCard = (u) => (u ? {
  id: String(u._id), username: u.username, login: u.login, role: u.role || 'user',
  bannedUntil: M.isBanned(u) ? u.bannedUntil : null, banReason: M.isBanned(u) ? u.banReason : '',
} : null);
const reasonText = (r) => String(r || '').trim().slice(0, 300);

api.get('/summary', async (req, res) => {
  // Number of videos and comments waiting for a decision (several reports of one object count once).
  res.json({ openReports: (await Report.distinct('target', { status: 'open' })).length });
});

// Reports grouped by the reported object: one row per video or comment with all its reports.
api.get('/reports', async (req, res) => {
  try {
    const open = req.query.status !== 'closed';
    const groups = await Report.aggregate([
      { $match: { status: open ? 'open' : { $ne: 'open' } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { targetType: '$targetType', target: '$target' },
          count: { $sum: 1 },
          targetOwner: { $first: '$targetOwner' },
          last: { $first: '$createdAt' },
          status: { $first: '$status' },
          action: { $first: '$action' },
          resolvedAt: { $first: '$resolvedAt' },
          resolvedBy: { $first: '$resolvedBy' },
          reports: { $push: { reason: '$reason', note: '$note', reporter: '$reporter', createdAt: '$createdAt' } },
        },
      },
      { $sort: open ? { count: -1, last: -1 } : { resolvedAt: -1 } },
      { $limit: 100 },
    ]);
    const videoIds = groups.filter((g) => g._id.targetType === 'video').map((g) => g._id.target);
    const commentIds = groups.filter((g) => g._id.targetType === 'comment').map((g) => g._id.target);
    const [videos, comments] = await Promise.all([
      VideoMeta.find({ _id: { $in: videoIds } }).select('title thumbnailUrl hiddenAt hiddenReason user').lean(),
      Comment.find({ _id: { $in: commentIds } }).select('text video hiddenAt hiddenReason user').lean(),
    ]);
    const commentVideos = await VideoMeta.find({ _id: { $in: comments.map((c) => c.video) } }).select('title').lean();
    const userIds = ids([
      ...groups.map((g) => g.targetOwner), ...groups.map((g) => g.resolvedBy),
      ...groups.flatMap((g) => g.reports.map((r) => r.reporter)),
    ]);
    const users = await User.find({ _id: { $in: userIds } }).select('username login role bannedUntil banReason').lean();
    const byId = (list) => new Map(list.map((x) => [String(x._id), x]));
    const V = byId(videos), C = byId(comments), CV = byId(commentVideos), U = byId(users);
    res.json(groups.map((g) => {
      const t = g._id.targetType === 'video' ? V.get(String(g._id.target)) : C.get(String(g._id.target));
      return {
        targetType: g._id.targetType,
        target: String(g._id.target),
        exists: Boolean(t),
        title: t && g._id.targetType === 'video' ? t.title : null,
        text: t && g._id.targetType === 'comment' ? t.text : null,
        thumbnailUrl: t && t.thumbnailUrl ? t.thumbnailUrl : null,
        link: t ? `/player/${g._id.targetType === 'video' ? t._id : t.video}` : null,
        videoTitle: t && g._id.targetType === 'comment' ? (CV.get(String(t.video)) || {}).title || null : null,
        hidden: Boolean(t && t.hiddenAt),
        hiddenReason: t && t.hiddenAt ? t.hiddenReason : '',
        owner: userCard(U.get(String(g.targetOwner))),
        count: g.count,
        last: g.last,
        status: g.status,
        action: g.action,
        resolvedAt: g.resolvedAt,
        resolvedBy: userCard(U.get(String(g.resolvedBy))),
        reports: g.reports.map((r) => ({
          reason: r.reason, reasonText: M.REASONS[r.reason], note: r.note, createdAt: r.createdAt,
          reporter: (U.get(String(r.reporter)) || {}).username || 'deleted user',
        })),
      };
    }));
  } catch (err) {
    console.error('Moderation reports error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Actions on a video or a comment: hide, unhide (restore), delete, dismiss (the reports).
api.post('/:type(video|comment)/:id/:action(hide|unhide|delete|dismiss)', async (req, res) => {
  const { type, id, action } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
  const reason = reasonText(req.body && req.body.reason);
  try {
    const Model = type === 'video' ? VideoMeta : Comment;
    const doc = await Model.findById(id).lean();
    const label = doc ? (type === 'video' ? doc.title : doc.text) : '';
    if (!doc) {
      // The object was deleted by its author meanwhile: only the reports are closed.
      await M.closeReports(type, id, req.user, 'gone');
      return res.json({ ok: true, gone: true });
    }
    if (action === 'hide') {
      if (!reason) return res.status(400).json({ error: 'Give a reason: the author will see it.' });
      await Model.updateOne({ _id: id }, { $set: { hiddenAt: new Date(), hiddenReason: reason } });
      await M.closeReports(type, id, req.user, 'hidden');
    } else if (action === 'unhide') {
      await Model.updateOne({ _id: id }, { $set: { hiddenAt: null, hiddenReason: '' } });
    } else if (action === 'delete') {
      await M.closeReports(type, id, req.user, 'deleted');
      if (type === 'video') await M.deleteVideoCompletely(doc);
      else await M.deleteCommentCompletely(doc);
    } else {
      await M.closeReports(type, id, req.user, 'dismissed');
    }
    await M.log(req.user, action, type, id, { label, reason });
    res.json({ ok: true });
  } catch (err) {
    console.error('Moderation action error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Users: search, restrict (ban), lift the restriction, change the role (administrators).
api.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 50);
  const filter = q ? { $or: [{ login: new RegExp(_.escapeRegExp(q), 'i') }, { username: new RegExp(_.escapeRegExp(q), 'i') }] } : {};
  const users = await User.find(filter).select('username login role bannedUntil banReason timestamp').sort({ timestamp: -1 }).limit(30).lean();
  const counts = await Report.aggregate([
    { $match: { targetOwner: { $in: users.map((u) => u._id) } } },
    { $group: { _id: '$targetOwner', reports: { $sum: 1 } } },
  ]);
  const n = new Map(counts.map((c) => [String(c._id), c.reports]));
  res.json(users.map((u) => ({
    ...userCard(u), joined: u.timestamp, reports: n.get(String(u._id)) || 0,
    canManage: M.canManageUser(req.user, u),
  })));
});

async function loadManaged(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: 'User not found' }); return null; }
  const target = await User.findById(req.params.id).select('username login role bannedUntil banReason').lean();
  if (!target) { res.status(404).json({ error: 'User not found' }); return null; }
  if (!M.canManageUser(req.user, target)) { res.status(403).json({ error: 'You cannot manage this account.' }); return null; }
  return target;
}

api.post('/users/:id/ban', async (req, res) => {
  const target = await loadManaged(req, res);
  if (!target) return;
  const days = Number(req.body && req.body.days);
  const reason = reasonText(req.body && req.body.reason);
  if (!M.BAN_DAYS.includes(days)) return res.status(400).json({ error: 'Choose the length of the restriction.' });
  if (!reason) return res.status(400).json({ error: 'Give a reason: the user will see it.' });
  const until = M.banEnd(days);
  await User.updateOne({ _id: target._id }, { $set: { bannedUntil: until, banReason: reason } });
  await signOutEverywhere(target._id); // all sessions end; the user can sign in again, restricted
  await M.log(req.user, 'ban', 'user', target._id, { label: target.login, reason, details: days ? `${days} d` : 'permanent' });
  res.json({ ok: true, bannedUntil: until });
});

api.post('/users/:id/unban', async (req, res) => {
  const target = await loadManaged(req, res);
  if (!target) return;
  await User.updateOne({ _id: target._id }, { $set: { bannedUntil: null, banReason: '' } });
  await M.log(req.user, 'unban', 'user', target._id, { label: target.login });
  res.json({ ok: true });
});

api.post('/users/:id/role', requireAdmin, async (req, res) => {
  const target = await loadManaged(req, res);
  if (!target) return;
  const role = req.body && req.body.role;
  if (!M.ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  await User.updateOne({ _id: target._id }, { $set: { role } });
  await M.log(req.user, 'role', 'user', target._id, { label: target.login, details: `${target.role || 'user'} → ${role}` });
  res.json({ ok: true });
});

api.get('/log', async (req, res) => {
  const rows = await ModerationLog.find().sort({ createdAt: -1 }).limit(100).populate('actor', 'username').lean();
  res.json(rows.map((r) => ({
    action: r.action, targetType: r.targetType, target: String(r.target), label: r.targetLabel,
    reason: r.reason, details: r.details, createdAt: r.createdAt, actor: r.actor ? r.actor.username : 'deleted user',
  })));
});

module.exports = { page, api };

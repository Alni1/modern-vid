// Roles, restrictions and moderation actions.
//
// Roles: user < moderator < admin.
//   moderator – handles reports, hides, restores and deletes videos and comments,
//               restricts (bans) ordinary users;
//   admin     – everything a moderator can do, plus restricting moderators and changing roles.
// A restricted (banned) user can sign in and watch, but cannot upload, comment or report.
const VideoMeta = require('../schemas/VideoMeta');
const Comment = require('../schemas/CommentSchema');
const User = require('../schemas/userSchema');
const ViewSession = require('../schemas/ViewSession');
const Report = require('../schemas/Report');
const ModerationLog = require('../schemas/ModerationLog');
const storage = require('./storage');

const ROLES = ['user', 'moderator', 'admin'];
const RANK = { user: 0, moderator: 1, admin: 2 };
const REASONS = {
  spam: 'Spam or misleading',
  abuse: 'Harassment or hate',
  inappropriate: 'Violent or sexual content',
  copyright: 'Copyright infringement',
  other: 'Something else',
};
/** Ban lengths offered in the moderation panel, in days (0 – permanent). */
const BAN_DAYS = [1, 7, 30, 0];
const PERMANENT = new Date('9999-12-31T00:00:00Z');

const rankOf = (user) => (user && RANK[user.role]) || 0;
const isModerator = (user) => rankOf(user) >= RANK.moderator;
const isAdmin = (user) => rankOf(user) >= RANK.admin;

/** True while the user is restricted. */
function isBanned(user, now = new Date()) {
  return Boolean(user && user.bannedUntil && new Date(user.bannedUntil) > now);
}

/**
 * Whether `actor` may restrict or change the role of `target`: only staff can, nobody acts on
 * themselves, and only an administrator acts on moderators and administrators.
 */
function canManageUser(actor, target) {
  if (!actor || !target || !isModerator(actor)) return false;
  if (String(actor._id) === String(target._id)) return false;
  return rankOf(actor) > rankOf(target) || isAdmin(actor);
}

/** End of a ban of `days` days (0 – permanent). */
function banEnd(days, now = new Date()) {
  return days === 0 ? PERMANENT : new Date(now.getTime() + days * 86400000);
}

/** Validates a report sent by a user. Returns null when it is malformed. */
function parseReport(body) {
  if (!body || typeof body !== 'object') return null;
  const { targetType, target, reason } = body;
  if (!['video', 'comment'].includes(targetType)) return null;
  if (typeof target !== 'string' || !/^[a-f0-9]{24}$/i.test(target)) return null;
  if (!Object.prototype.hasOwnProperty.call(REASONS, reason)) return null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  return { targetType, target, reason, note };
}

/** Can `viewer` see a hidden video or comment? Its author and staff can. */
function canSeeHidden(viewer, authorId) {
  return Boolean(viewer && (isModerator(viewer) || String(viewer._id) === String(authorId)));
}

// ---- actions with database access ------------------------------------------------

async function log(actor, action, targetType, target, { label = '', reason = '', details = '' } = {}) {
  await ModerationLog.create({
    actor: actor._id, action, targetType, target, targetLabel: String(label).slice(0, 200), reason, details,
  });
}

/** Closes the open reports of an object with the given outcome. */
async function closeReports(targetType, target, actor, action) {
  await Report.updateMany(
    { targetType, target, status: 'open' },
    { $set: { status: action === 'dismissed' ? 'dismissed' : 'resolved', action, resolvedBy: actor ? actor._id : null, resolvedAt: new Date() } },
  );
}

/**
 * Deletes a video with everything that belongs to it: files in the storage, comments,
 * view sessions and the link from the author's account.
 */
async function deleteVideoCompletely(video) {
  if (video.storageKey && video.videoId) {
    await storage.deletePrefix(`videos/${video.videoId}`).catch((err) => console.error(`Error deleting files of video ${video._id}:`, err));
  }
  await Promise.all([
    VideoMeta.deleteOne({ _id: video._id }),
    Comment.deleteMany({ video: video._id }),
    ViewSession.deleteMany({ video: video._id }),
    User.updateOne({ _id: video.user }, { $pull: { videos: video._id } }),
  ]);
  await closeReports('video', video._id, null, 'deleted');
}

async function deleteCommentCompletely(comment) {
  await Promise.all([
    Comment.deleteOne({ _id: comment._id }),
    VideoMeta.updateOne({ _id: comment.video }, { $pull: { comments: comment._id } }),
    User.updateOne({ _id: comment.user }, { $pull: { comments: comment._id } }),
  ]);
  await closeReports('comment', comment._id, null, 'deleted');
}

module.exports = {
  ROLES, REASONS, BAN_DAYS, PERMANENT,
  isModerator, isAdmin, isBanned, canManageUser, banEnd, parseReport, canSeeHidden,
  log, closeReports, deleteVideoCompletely, deleteCommentCompletely,
};

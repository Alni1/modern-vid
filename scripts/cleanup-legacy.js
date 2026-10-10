/**
 * Removes videos of the first platform version whose files were stored in
 * Firebase Storage (no longer accessible): their records, comments and references.
 *   npm run cleanup-legacy          — only lists what would be deleted
 *   npm run cleanup-legacy -- --yes — deletes
 */
require('dotenv').config();
const mongoose = require('mongoose');
const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const Comment = require('../schemas/CommentSchema');
const TranscodeJob = require('../schemas/TranscodeJob');

(async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const legacy = await VideoMeta.find({ $or: [{ storageKey: { $exists: false } }, { storageKey: null }] })
    .select('_id title uploadedAt')
    .lean();
  legacy.forEach((v) => console.log(`${v._id}  ${v.uploadedAt ? v.uploadedAt.toISOString().slice(0, 10) : ''}  ${v.title || ''}`));
  console.log(`${legacy.length} legacy video(s) found`);

  if (legacy.length && process.argv.includes('--yes')) {
    const ids = legacy.map((v) => v._id);
    const comments = await Comment.find({ video: { $in: ids } }).select('_id').lean();
    const commentIds = comments.map((c) => c._id);
    await Comment.deleteMany({ _id: { $in: commentIds } });
    await User.updateMany({}, { $pull: { videos: { $in: ids }, comments: { $in: commentIds } } });
    await TranscodeJob.deleteMany({ video: { $in: ids } });
    const res = await VideoMeta.deleteMany({ _id: { $in: ids } });
    console.log(`deleted ${res.deletedCount} video(s) and ${commentIds.length} comment(s)`);
  } else if (legacy.length) {
    console.log('Nothing deleted. Run `npm run cleanup-legacy -- --yes` to delete them.');
  }
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

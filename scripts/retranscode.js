/**
 * Puts videos back into the HLS transcoding queue.
 *   npm run retranscode            — all videos whose processing failed
 *   npm run retranscode -- <id>    — one video by its _id (also re-transcodes a ready one)
 * The running server picks the jobs up (or the next `npm start` does).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const VideoMeta = require('../schemas/VideoMeta');
const TranscodeJob = require('../schemas/TranscodeJob');

(async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const id = process.argv[2];
  const filter = id ? { _id: id } : { status: 'failed' };
  const videos = await VideoMeta.find({ ...filter, storageKey: { $exists: true, $ne: null } }).select('_id title');
  for (const v of videos) {
    await VideoMeta.updateOne({ _id: v._id }, { status: 'processing', processingProgress: 0, $unset: { processingError: 1 } });
    await TranscodeJob.create({ video: v._id });
    console.log(`queued: ${v._id} ${v.title || ''}`);
  }
  console.log(`${videos.length} video(s) queued`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

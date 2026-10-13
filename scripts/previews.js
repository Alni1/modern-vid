/**
 * Generates seek-bar preview frames for videos transcoded before this feature existed
 * (the server also does this automatically at start-up).
 *   npm run previews            — all ready videos without previews
 *   npm run previews -- <id>    — one video by its _id (regenerates the previews)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const VideoMeta = require('../schemas/VideoMeta');
const { makePreviews, backfillPreviews } = require('../utils/transcoder/previews');

(async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const id = process.argv[2];
  if (id) {
    const video = await VideoMeta.findById(id);
    if (!video) throw new Error(`Video ${id} not found`);
    await makePreviews(video);
    console.log(`previews: ${video._id} ${video.title || ''}`);
  } else {
    console.log(`${await backfillPreviews()} video(s) processed`);
  }
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

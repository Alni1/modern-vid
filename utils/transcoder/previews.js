const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const VideoMeta = require('../../schemas/VideoMeta');
const storage = require('../storage');
const { thumbsPlan, buildThumbsVtt, runFfmpeg } = require('./hls');

/**
 * Generates the seek-bar preview frames of an already transcoded video from its lowest HLS
 * quality (fast: a small stream is decoded). New videos get them during transcoding; this is
 * for videos transcoded before the feature existed.
 */
async function makePreviews(video) {
  if (!video.hls || !video.hls.masterKey || !video.duration) throw new Error('no HLS stream or duration');
  const prefix = path.posix.dirname(video.hls.masterKey);
  // The lowest-bitrate media playlist is taken from the master playlist, so both the current
  // flat layout (360p.m3u8) and the layout of early versions (v3/index.m3u8) are supported.
  const master = await storage.getLocalPath(video.hls.masterKey);
  let text;
  try {
    text = await fs.readFile(master.path, 'utf8');
  } finally {
    await master.release();
  }
  const variants = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /^#EXT-X-STREAM-INF:.*?BANDWIDTH=(\d+)/.exec(line);
    const size = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    if (m && lines[i + 1]) {
      variants.push({
        bandwidth: Number(m[1]),
        uri: lines[i + 1].trim(),
        width: size ? Number(size[1]) : 640,
        height: size ? Number(size[2]) : 360,
      });
    }
  });
  if (!variants.length) throw new Error('no variants in the master playlist');
  variants.sort((a, b) => a.bandwidth - b.bandwidth);
  const lowest = variants[0];

  const playlist = await storage.getLocalPath(`${prefix}/${lowest.uri}`);
  const workDir = path.join(os.tmpdir(), `modernvid-previews-${video.videoId}`);
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  try {
    const plan = thumbsPlan({ width: lowest.width, height: lowest.height, duration: video.duration });
    await runFfmpeg([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-i', playlist.path,
      '-vf', `fps=1/${plan.interval},scale=${plan.width}:${plan.height}:flags=bilinear,tile=${plan.cols}x${plan.rows}`,
      '-q:v', '5', '-start_number', '0', '-f', 'image2', 'sprite_%03d.jpg',
    ], { cwd: workDir });
    await fs.writeFile(path.join(workDir, 'thumbs.vtt'), buildThumbsVtt(plan, video.duration));
    await storage.putDir(prefix, workDir, { move: true });
    await VideoMeta.updateOne({ _id: video._id }, { previewsKey: `${prefix}/thumbs.vtt` });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await playlist.release();
  }
}

/** Ready videos that have an HLS stream but no preview frames yet. */
function videosWithoutPreviews() {
  return VideoMeta.find({ status: 'ready', 'hls.masterKey': { $exists: true }, previewsKey: { $exists: false } });
}

/** Generates missing previews one video at a time; returns the number of processed videos. */
async function backfillPreviews(log = console.log) {
  const videos = await videosWithoutPreviews();
  for (const v of videos) {
    try {
      await makePreviews(v);
      log(`[previews] ${v._id} ${v.title || ''}: done`);
    } catch (err) {
      log(`[previews] ${v._id} ${v.title || ''}: failed: ${err.message.split('\n')[0]}`);
    }
  }
  return videos.length;
}

module.exports = { makePreviews, backfillPreviews };

const ffmpeg = require('fluent-ffmpeg');

// FFMPEG_PATH / FFPROBE_PATH select a system-wide FFmpeg (recommended: a current build
// with GPU support). Otherwise the binaries bundled with @ffmpeg-installer /
// @ffprobe-installer are used, and as the last resort the ones from PATH.
function pick(envName, pkg) {
  if (process.env[envName]) return process.env[envName];
  try {
    return require(pkg).path;
  } catch {
    return null;
  }
}
const ffmpegPath = pick('FFMPEG_PATH', '@ffmpeg-installer/ffmpeg');
const ffprobePath = pick('FFPROBE_PATH', '@ffprobe-installer/ffprobe');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

/** Reads media information (duration, streams) of a file. */
function probe(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/** Saves one frame of the video as a JPEG thumbnail. */
function makeThumbnail(videoPath, folder, filename, { at = 1, size = '320x180' } = {}) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({ timestamps: [at], filename, folder, size })
      .on('end', resolve)
      .on('error', reject);
  });
}

module.exports = { ffmpeg, probe, makeThumbnail };

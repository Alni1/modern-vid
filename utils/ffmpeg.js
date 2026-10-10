const ffmpeg = require('fluent-ffmpeg');

// Use the binaries bundled with @ffmpeg-installer / @ffprobe-installer so that
// FFmpeg does not have to be installed system-wide. Falls back to PATH if missing.
try {
  ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
} catch (err) {
  console.warn('[ffmpeg] bundled ffmpeg not found, using the one from PATH');
}
try {
  ffmpeg.setFfprobePath(require('@ffprobe-installer/ffprobe').path);
} catch (err) {
  console.warn('[ffmpeg] bundled ffprobe not found, using the one from PATH');
}

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

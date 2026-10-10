const { execFile } = require('child_process');

/**
 * Chooses the H.264 encoder:
 *   TRANSCODE_ENCODER=cpu   — libx264 (software, works everywhere)
 *   TRANSCODE_ENCODER=nvenc — h264_nvenc (NVIDIA GPU)
 *   TRANSCODE_ENCODER=auto  — (default) NVENC if a short test encode succeeds, otherwise CPU
 * The result of the auto-detection is cached for the lifetime of the process.
 */
let cached = null;

function tryNvenc(ffmpegPath) {
  return new Promise((resolve) => {
    const done = (err, stderr) => {
      if (err) console.log(`[transcoder] NVENC not available: ${(stderr || err.message).trim().split('\n')[0]}`);
      resolve(!err);
    };
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=0.5',
      '-c:v', 'h264_nvenc', '-f', 'null', '-',
    ];
    execFile(ffmpegPath, args, { windowsHide: true, timeout: 20000 }, (err, _out, stderr) => done(err, stderr));
  });
}

async function detectEncoder(ffmpegPath) {
  const forced = (process.env.TRANSCODE_ENCODER || 'auto').toLowerCase();
  if (forced === 'cpu' || forced === 'nvenc') return forced;
  if (cached) return cached;
  cached = (await tryNvenc(ffmpegPath)) ? 'nvenc' : 'cpu';
  console.log(`[transcoder] encoder: ${cached === 'nvenc' ? 'NVIDIA NVENC (GPU)' : 'libx264 (CPU)'}`);
  return cached;
}

/** Called when NVENC fails during a real job: switch to CPU for the rest of the process lifetime. */
function disableNvenc() {
  cached = 'cpu';
}

module.exports = { detectEncoder, disableNvenc };

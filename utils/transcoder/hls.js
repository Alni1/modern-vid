const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

// FFMPEG_PATH lets you use a system-wide FFmpeg; otherwise the npm-bundled binary is used.
let FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
if (!process.env.FFMPEG_PATH) {
  try {
    FFMPEG = require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    /* use ffmpeg from PATH */
  }
}

const SEGMENT_SECONDS = 4;

/**
 * H.264 level for a rendition and the matching RFC 6381 codec string (Main profile).
 * The level depends on the macroblock rate, i.e. on resolution and frame rate.
 */
function h264Level(r, fps = 30) {
  const mbPerSec = Math.ceil(r.width / 16) * Math.ceil(r.height / 16) * fps;
  const levels = [
    { max: 40500, level: '3.0', codec: 'avc1.4d401e' },
    { max: 108000, level: '3.1', codec: 'avc1.4d401f' },
    { max: 216000, level: '3.2', codec: 'avc1.4d4020' },
    { max: 245760, level: '4.0', codec: 'avc1.4d4028' },
    { max: 522240, level: '4.2', codec: 'avc1.4d402a' },
  ];
  return levels.find((l) => mbPerSec <= l.max) || { level: '5.1', codec: 'avc1.4d4033' };
}

/** Codec strings of a rendition for the CODECS attribute of the master playlist. */
function codecsOf(r, codec, hasAudio, fps) {
  if (codec === 'libvpx-vp9') return hasAudio ? 'vp09.00.40.08,opus' : 'vp09.00.40.08';
  const video = h264Level(r, fps).codec;
  return hasAudio ? `${video},mp4a.40.2` : video;
}

/**
 * FFmpeg arguments for one rendition: scaled video + audio, packaged as HLS with
 * fragmented MP4 (CMAF) segments into `dir` (index.m3u8, init.mp4, seg_00000.m4s, …).
 * A keyframe is forced every SEGMENT_SECONDS, so all renditions have identical
 * segment boundaries and the player can switch quality at any segment.
 */
function buildRenditionArgs({ input, dir, r, source, codec = 'libx264' }) {
  const gop = Math.round(source.fps * SEGMENT_SECONDS);
  // -loglevel error: stderr then contains only the actual error message, not encoder statistics.
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', path.resolve(input), '-map', '0:v:0'];
  if (source.hasAudio) args.push('-map', '0:a:0');
  args.push('-vf', `scale=${r.width}:${r.height},format=yuv420p`);
  if (codec === 'libvpx-vp9') {
    // Test mode only: open-source browser builds cannot decode H.264/AAC.
    args.push('-c:v', 'libvpx-vp9', '-b:v', `${r.videoKbps}k`, '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1');
  } else {
    args.push(
      '-c:v', 'libx264', '-preset', process.env.TRANSCODE_PRESET || 'veryfast',
      '-profile:v', 'main', '-level:v', h264Level(r, source.fps).level,
      '-b:v', `${r.videoKbps}k`, '-maxrate', `${Math.round(r.videoKbps * 1.07)}k`, '-bufsize', `${r.videoKbps * 1.5}k`,
      '-sc_threshold', '0',
    );
  }
  args.push('-g', String(gop), '-keyint_min', String(gop));
  if (source.hasAudio) {
    args.push('-c:a', codec === 'libvpx-vp9' ? 'libopus' : 'aac', '-b:a', `${r.audioKbps}k`, '-ac', '2', '-ar', '48000');
  }
  args.push(
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    // Relative names + cwd = dir: older FFmpeg (4.x) writes init.mp4 into the working
    // directory, not next to the playlist.
    '-hls_segment_filename', 'seg_%05d.m4s',
    '-progress', 'pipe:1', '-nostats',
    'index.m3u8',
  );
  return args;
}

/** Master playlist listing all renditions (highest first) with bandwidth, resolution and codecs. */
function buildMasterPlaylist(ladder, source, codec) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  ladder.forEach((r, i) => {
    const audio = source.hasAudio ? r.audioKbps : 0;
    const peak = Math.round((r.videoKbps * 1.07 + audio) * 1000);
    const avg = Math.round((r.videoKbps + audio) * 1000);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${avg},RESOLUTION=${r.width}x${r.height},` +
      `CODECS="${codecsOf(r, codec, source.hasAudio, source.fps)}",FRAME-RATE=${source.fps.toFixed(3)}`,
      `v${i}/index.m3u8`,
    );
  });
  return lines.join('\n') + '\n';
}

/** Runs FFmpeg, reporting progress (0..1) from its -progress output. */
function runFfmpeg(args, { duration, onProgress, signal, cwd } = {}) {
  return new Promise((resolve, reject) => {
    // stdin is not used: ffmpeg must never wait for keyboard input.
    const proc = spawn(FFMPEG, args, { windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      const m = /out_time_(?:us|ms)=(\d+)/.exec(chunk.toString());
      if (m && duration && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
    });
    proc.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    if (signal) signal.addEventListener('abort', () => proc.kill('SIGKILL'), { once: true });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))));
  });
}

/**
 * Transcodes `input` into HLS renditions inside `outDir`:
 *   outDir/master.m3u8, outDir/v0/{index.m3u8,init.mp4,seg_*.m4s}, outDir/v1/…
 * Renditions are encoded one after another (works with any FFmpeg 4.x+).
 */
async function transcodeToHls({ input, outDir, ladder, source, codec = 'libx264', onProgress, signal }) {
  await fs.mkdir(outDir, { recursive: true });
  // Progress is weighted by the pixel count of each rendition (bigger ones take longer).
  const weights = ladder.map((r) => r.width * r.height);
  const total = weights.reduce((a, b) => a + b, 0);
  let done = 0;
  for (let i = 0; i < ladder.length; i++) {
    const dir = path.join(outDir, `v${i}`);
    await fs.mkdir(dir, { recursive: true });
    const args = buildRenditionArgs({ input, dir, r: ladder[i], source, codec });
    await runFfmpeg(args, {
      cwd: dir,
      duration: source.duration,
      signal,
      onProgress: (p) => onProgress && onProgress((done + p * weights[i]) / total),
    });
    // Fail early (instead of producing an unplayable stream) if the init segment is missing.
    await fs.access(path.join(dir, 'init.mp4'));
    done += weights[i];
  }
  await fs.writeFile(path.join(outDir, 'master.m3u8'), buildMasterPlaylist(ladder, source, codec));
  if (onProgress) onProgress(1);
  return ladder;
}

module.exports = { SEGMENT_SECONDS, buildRenditionArgs, buildMasterPlaylist, runFfmpeg, transcodeToHls, FFMPEG };

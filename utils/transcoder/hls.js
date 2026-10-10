const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { detectEncoder, disableNvenc } = require('./encoder');

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

/** Encoder options of one output. */
function videoArgs(r, source, codec, encoder) {
  const fps = r.fps || source.fps;
  const gop = Math.round(fps * SEGMENT_SECONDS); // one keyframe per segment
  const rate = ['-b:v', `${r.videoKbps}k`, '-maxrate', `${Math.round(r.videoKbps * 1.07)}k`, '-bufsize', `${r.videoKbps * 1.5}k`];
  if (codec === 'libvpx-vp9') {
    // Test mode only: open-source browser builds cannot decode H.264/AAC.
    return ['-c:v', 'libvpx-vp9', '-b:v', `${r.videoKbps}k`, '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
      '-g', String(gop), '-keyint_min', String(gop)];
  }
  const level = h264Level(r, fps).level;
  if (encoder === 'nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', process.env.NVENC_PRESET || 'fast', '-profile:v', 'main', '-level', level,
      '-rc', 'vbr', ...rate, '-g', String(gop), '-forced-idr', '1', '-no-scenecut', '1'];
  }
  return ['-c:v', 'libx264', '-preset', process.env.TRANSCODE_PRESET || 'veryfast', '-profile:v', 'main', '-level:v', level,
    ...rate, '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0'];
}

/**
 * FFmpeg arguments that decode the source ONCE and encode several renditions in parallel
 * (split + scale filter, one HLS output per rendition). Outputs use a flat layout with
 * relative names and the process runs with cwd = outDir, which works with FFmpeg 4.x
 * (it writes init segments into the working directory) as well as newer versions:
 *   outDir/720p.m3u8, outDir/720p_init.mp4, outDir/720p_seg_00000.m4s, …
 * A keyframe every SEGMENT_SECONDS keeps segment boundaries identical in all renditions,
 * so the player can switch quality at any segment.
 */
function buildArgs({ input, renditions, source, codec = 'libx264', encoder = 'cpu' }) {
  const n = renditions.length;
  // Frame-rate reduction first (fewer frames to scale), fast bilinear scaling.
  const scale = (r, i, from) => {
    const fps = r.fps && r.fps < source.fps ? `fps=${r.fps},` : '';
    return `${from}${fps}scale=${r.width}:${r.height}:flags=bilinear,format=yuv420p[o${i}]`;
  };
  const filter = n === 1
    ? scale(renditions[0], 0, '[0:v]')
    : [`[0:v]split=${n}${renditions.map((_, i) => `[s${i}]`).join('')}`, ...renditions.map((r, i) => scale(r, i, `[s${i}]`))].join(';');
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    // Hardware-accelerated decoding (GPU) when available; FFmpeg falls back to the CPU otherwise.
    ...(process.env.TRANSCODE_HWDECODE === 'off' ? [] : ['-hwaccel', 'auto']),
    '-i', path.resolve(input),
    // Run the split/scale filter graph on all CPU cores (it is single-threaded by default).
    '-filter_complex_threads', String(Math.max(1, os.cpus().length)),
    '-filter_complex', filter,
  ];
  renditions.forEach((r, i) => {
    args.push('-map', `[o${i}]`);
    if (source.hasAudio) args.push('-map', '0:a:0');
    args.push(...videoArgs(r, source, codec, encoder));
    if (source.hasAudio) {
      args.push('-c:a', codec === 'libvpx-vp9' ? 'libopus' : 'aac', '-b:a', `${r.audioKbps}k`, '-ac', '2', '-ar', '48000');
    }
    args.push(
      '-f', 'hls',
      '-hls_time', String(SEGMENT_SECONDS),
      '-hls_playlist_type', 'vod',
      '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', `${r.name}_init.mp4`,
      '-hls_segment_filename', `${r.name}_seg_%05d.m4s`,
      `${r.name}.m3u8`,
    );
  });
  args.push('-progress', 'pipe:1', '-nostats');
  return args;
}

/** Master playlist listing the renditions (highest first) with bandwidth, resolution and codecs. */
function buildMasterPlaylist(ladder, source, codec) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  ladder.forEach((r) => {
    const audio = source.hasAudio ? r.audioKbps : 0;
    const peak = Math.round((r.videoKbps * 1.07 + audio) * 1000);
    const avg = Math.round((r.videoKbps + audio) * 1000);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${avg},RESOLUTION=${r.width}x${r.height},` +
      `CODECS="${codecsOf(r, codec, source.hasAudio, r.fps || source.fps)}",FRAME-RATE=${(r.fps || source.fps).toFixed(3)}`,
      `${r.name}.m3u8`,
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
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`))));
  });
}

/** Encodes a group of renditions in one FFmpeg process; falls back from NVENC to CPU on failure. */
async function encodeGroup({ input, outDir, renditions, source, codec, encoder, onProgress, signal }) {
  const run = (enc) => runFfmpeg(buildArgs({ input, renditions, source, codec, encoder: enc }), {
    cwd: outDir, duration: source.duration, onProgress, signal,
  });
  try {
    await run(encoder);
  } catch (err) {
    if (encoder !== 'nvenc' || codec !== 'libx264') throw err;
    console.warn(`[transcoder] NVENC failed, falling back to CPU: ${err.message.split('\n')[0]}`);
    disableNvenc();
    await run('cpu');
    encoder = 'cpu';
  }
  // Fail early (instead of producing an unplayable stream) if an init segment is missing.
  for (const r of renditions) await fs.access(path.join(outDir, `${r.name}_init.mp4`));
  return encoder;
}

/**
 * Transcodes `input` into HLS renditions inside `outDir` in two passes:
 *   1. the lowest rendition alone — the video can be published after this short pass
 *      (`onPartial` is called with the renditions available so far);
 *   2. all other renditions together, decoding the source only once.
 * `ladder` is ordered from the highest to the lowest rendition.
 */
async function transcodeToHls({ input, outDir, ladder, source, codec = 'libx264', onProgress, onPartial, signal }) {
  await fs.mkdir(outDir, { recursive: true });
  let encoder = codec === 'libx264' ? await detectEncoder(FFMPEG) : 'cpu';
  const lowest = ladder[ladder.length - 1];
  const rest = ladder.slice(0, -1);
  // Share of the total time taken by pass 1 (decoding dominates small renditions).
  const share = rest.length ? 0.3 : 1;
  const report = (from, size) => (p) => onProgress && onProgress(from + p * size);

  encoder = await encodeGroup({ input, outDir, renditions: [lowest], source, codec, encoder, onProgress: report(0, share), signal });
  await fs.writeFile(path.join(outDir, 'master.m3u8'), buildMasterPlaylist([lowest], source, codec));
  if (rest.length && onPartial) await onPartial([lowest]);

  if (rest.length) {
    await encodeGroup({ input, outDir, renditions: rest, source, codec, encoder, onProgress: report(share, 1 - share), signal });
    await fs.writeFile(path.join(outDir, 'master.m3u8'), buildMasterPlaylist(ladder, source, codec));
  }
  if (onProgress) onProgress(1);
  return { ladder, encoder };
}

module.exports = { SEGMENT_SECONDS, buildArgs, buildMasterPlaylist, runFfmpeg, transcodeToHls, h264Level, FFMPEG };

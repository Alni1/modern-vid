/**
 * Bitrate ladder: the set of renditions a video is transcoded into.
 * "p" values refer to the shorter side, so portrait videos get the same ladder.
 * Renditions above the source resolution are skipped (no upscaling);
 * at least one rendition is always produced.
 */
const LADDER = [
  { name: '1080p', short: 1080, videoKbps: 5000, audioKbps: 128 },
  { name: '720p', short: 720, videoKbps: 2800, audioKbps: 128 },
  { name: '480p', short: 480, videoKbps: 1400, audioKbps: 96 },
  { name: '360p', short: 360, videoKbps: 800, audioKbps: 96 },
];

function even(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * @param {{width:number,height:number}} source displayed source size (rotation applied)
 * @returns {Array<{name,width,height,videoKbps,audioKbps}>} renditions, highest first
 */
function buildLadder(source) {
  const short = Math.min(source.width, source.height);
  let steps = LADDER.filter((s) => s.short <= short);
  if (steps.length === 0) {
    const low = LADDER[LADDER.length - 1];
    steps = [{ ...low, name: `${even(short)}p`, short: even(short) }];
  }
  return steps.map((s) => {
    const f = s.short / short;
    return {
      name: s.name,
      width: even(source.width * f),
      height: even(source.height * f),
      videoKbps: s.videoKbps,
      audioKbps: s.audioKbps,
    };
  });
}

/** Extracts displayed size, rotation, fps, duration and audio presence from ffprobe output. */
function describeSource(probe) {
  const v = probe.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream');
  let rotation = 0;
  if (v.tags && v.tags.rotate) rotation = Number(v.tags.rotate);
  const sd = (v.side_data_list || []).find((d) => d.rotation !== undefined);
  if (sd) rotation = Number(sd.rotation);
  const rotated = Math.abs(rotation) % 180 === 90;
  const [num, den] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  const fps = den ? num / den : num;
  return {
    width: rotated ? v.height : v.width,
    height: rotated ? v.width : v.height,
    fps: Number.isFinite(fps) && fps > 0 ? Math.min(fps, 60) : 30,
    duration: Number(probe.format.duration) || Number(v.duration) || 0,
    hasAudio: probe.streams.some((s) => s.codec_type === 'audio'),
  };
}

module.exports = { LADDER, buildLadder, describeSource };

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeViewerPreset, sanitizeAuthorTheme } = require('../utils/presetValidation');
const { buildLadder, describeSource } = require('../utils/transcoder/ladder');
const { h264Level, buildThumbsVtt, thumbsPlan, buildMasterPlaylist } = require('../utils/transcoder/hls');

test('preset validation drops unknown keys, bad values and CSS injection', () => {
  const out = sanitizeViewerPreset({
    theme: { accent: '#FF0000', background: 'red;}body{', radius: 99 },
    layout: { left: ['play', 'evil', 'play'] },
    quality: { maxHeight: null, mode: 'x' },
    hotkeys: { toggleMute: ['k'] },
    foo: 1,
  });
  assert.deepEqual(out, { theme: { accent: '#ff0000' }, layout: { left: ['play'] }, quality: { maxHeight: null }, hotkeys: { toggleMute: ['k'] } });
  assert.deepEqual(sanitizeAuthorTheme({ accent: '#00ff00', fontFamily: 'x;}body{' }), { accent: '#00ff00' });
});

test('bitrate ladder: no upscaling, even sizes, high frame rate only from 720p', () => {
  const ladder = buildLadder({ width: 1920, height: 1080, fps: 60 });
  assert.deepEqual(ladder.map((r) => r.name), ['1080p', '720p', '480p', '360p']);
  assert.deepEqual(ladder.map((r) => r.fps), [60, 60, 30, 30]);
  assert.equal(ladder[2].width, 854);
  assert.deepEqual(buildLadder({ width: 640, height: 360, fps: 30 }).map((r) => r.name), ['360p']);
  const vertical = buildLadder({ width: 1080, height: 1920, fps: 30 });
  assert.equal(vertical[0].width, 1080);
  assert.equal(vertical[0].height, 1920);
});

test('source description applies rotation', () => {
  const d = describeSource({
    streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] }],
    format: { duration: '12.5' },
  });
  assert.equal(d.width, 1080);
  assert.equal(d.height, 1920);
  assert.equal(d.duration, 12.5);
  assert.equal(d.hasAudio, false);
});

test('H.264 level follows the macroblock rate', () => {
  assert.equal(h264Level({ width: 1920, height: 1080 }, 60).level, '4.2');
  assert.equal(h264Level({ width: 1920, height: 1080 }, 30).level, '4.0');
  assert.equal(h264Level({ width: 854, height: 480 }, 30).level, '3.1');
  assert.equal(h264Level({ width: 640, height: 360 }, 30).level, '3.0');
});

test('preview sprites: interval and VTT regions', () => {
  const plan = thumbsPlan({ width: 1920, height: 1080, duration: 300 });
  assert.equal(plan.interval, 2);
  assert.equal(plan.height, 90);
  const vtt = buildThumbsVtt(plan, 300);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:03:20\.000 --> 00:03:22\.000\nsprite_001\.jpg#xywh=0,0,160,90/);
  assert.equal(thumbsPlan({ width: 1920, height: 1080, duration: 3600 }).interval, 12);
});

test('master playlist lists every rendition with codecs', () => {
  const source = { width: 1920, height: 1080, fps: 30, hasAudio: true };
  const text = buildMasterPlaylist(buildLadder(source), source, 'libx264');
  assert.equal((text.match(/#EXT-X-STREAM-INF/g) || []).length, 4);
  assert.match(text, /AVERAGE-BANDWIDTH=5128000,RESOLUTION=1920x1080,CODECS="avc1\.4d4028,mp4a\.40\.2"/);
});

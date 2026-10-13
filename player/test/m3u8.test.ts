import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaster, parseMedia, parseAttributes, isMasterPlaylist } from '../src/streaming/m3u8';

const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=5478000,AVERAGE-BANDWIDTH=5128000,RESOLUTION=1920x1080,CODECS="avc1.4d402a,mp4a.40.2",FRAME-RATE=60.000
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=952000,AVERAGE-BANDWIDTH=896000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",FRAME-RATE=30.000
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3124000,RESOLUTION=1280x720,CODECS="avc1.4d4020,mp4a.40.2"
720p.m3u8
`;

test('attribute lists keep quoted commas', () => {
  const a = parseAttributes('BANDWIDTH=1,CODECS="avc1.4d401e,mp4a.40.2",RESOLUTION=640x360');
  assert.equal(a.CODECS, 'avc1.4d401e,mp4a.40.2');
  assert.equal(a.RESOLUTION, '640x360');
});

test('master playlist: levels sorted low to high, average bandwidth preferred', () => {
  assert.ok(isMasterPlaylist(MASTER));
  const levels = parseMaster(MASTER, 'http://host/v/hls/master.m3u8');
  assert.deepEqual(levels.map((l) => l.height), [360, 720, 1080]);
  assert.deepEqual(levels.map((l) => l.bitrate), [896000, 3124000, 5128000]);
  assert.equal(levels[0].url, 'http://host/v/hls/360p.m3u8');
  assert.deepEqual(levels.map((l) => l.index), [0, 1, 2]);
});

test('media playlist: init segment, segment start times, total duration', () => {
  const pl = parseMedia(`#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="360p_init.mp4"
#EXTINF:4.000,
360p_seg_00000.m4s
#EXTINF:4.000,
360p_seg_00001.m4s
#EXTINF:1.500,
360p_seg_00002.m4s
#EXT-X-ENDLIST
`, 'http://host/hls/360p.m3u8');
  assert.equal(pl.initUrl, 'http://host/hls/360p_init.mp4');
  assert.equal(pl.segments.length, 3);
  assert.deepEqual(pl.segments.map((s) => s.start), [0, 4, 8]);
  assert.equal(pl.totalDuration, 9.5);
  assert.equal(pl.targetDuration, 4);
});

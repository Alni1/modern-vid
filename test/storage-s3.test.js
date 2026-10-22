// S3 storage driver without a network: the S3 client is replaced by a recorder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S3Storage = require('../utils/storage/S3Storage');

const make = (opts = {}) => {
  const s = new S3Storage({ bucket: 'b', endpoint: 'http://127.0.0.1:1', accessKeyId: 'k', secretAccessKey: 's', ...opts });
  s.sent = [];
  s.client = { send: async (cmd) => { s.sent.push(cmd); if (cmd.input.Body && cmd.input.Body.destroy) cmd.input.Body.destroy(); return {}; } };
  return s;
};

test('S3 keys: normalized, no path traversal', () => {
  assert.equal(S3Storage.clean('/videos\\a/b.m4s'), 'videos/a/b.m4s');
  assert.throws(() => S3Storage.clean('videos/../secret'));
  assert.throws(() => S3Storage.clean(''));
});

test('S3 putDir uploads playlists after segments, master playlist last', async () => {
  const s = make();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's3test-'));
  for (const f of ['master.m3u8', '360p.m3u8', '360p_init.mp4', '360p_seg_00000.m4s', 'thumbs.vtt']) fs.writeFileSync(path.join(dir, f), 'x');
  const n = await s.putDir('videos/v/hls', dir);
  assert.equal(n, 5);
  const keys = s.sent.map((c) => c.input.Key);
  assert.equal(keys[keys.length - 1], 'videos/v/hls/master.m3u8');
  const firstPlaylist = keys.findIndex((k) => /\.(m3u8|vtt)$/.test(k));
  assert.ok(keys.slice(firstPlaylist).every((k) => /\.(m3u8|vtt)$/.test(k)), keys.join(','));
  const seg = s.sent.find((c) => c.input.Key.endsWith('.m4s'));
  assert.equal(seg.input.ContentType, 'video/iso.segment');
  assert.match(seg.input.CacheControl, /immutable/);
  await new Promise((r) => setTimeout(r, 50)); // let the destroyed read streams close
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S3 media: segments are redirected to a signed URL, playlists are proxied', async () => {
  const s = make({ publicUrl: 'https://cdn.example' });
  let proxied = null;
  s.proxy = async (key) => { proxied = key; };
  const run = (p) => new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, redirect(code, url) { resolve({ code, url, headers: this.headers }); }, status() { return this; }, send() { resolve({ code: 400 }); } };
    s.middleware()({ method: 'GET', path: p, headers: {} }, res, () => resolve({ next: true }));
    if (/m3u8$/.test(p)) setImmediate(() => resolve({ proxied }));
  });
  const r = await run('/videos/v/hls/360p_seg_00001.m4s');
  assert.equal(r.code, 302);
  assert.equal(r.url, 'https://cdn.example/videos/v/hls/360p_seg_00001.m4s');
  assert.deepEqual(await run('/videos/v/hls/master.m3u8'), { proxied: 'videos/v/hls/master.m3u8' });
  assert.equal((await run('/videos/%2E%2E/x.jpg')).code, 400);
});

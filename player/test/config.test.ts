import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, resolveConfig } from '../src/config/merge';
import { DEFAULT_CONFIG } from '../src/config/defaults';
import { parseThumbsVtt, cueAt } from '../src/ui/thumbnails';
import { findConflicts } from '../src/hotkeys';

test('deep merge ignores unknown keys and wrong types, accepts null for nullable fields', () => {
  const out = deepMerge(DEFAULT_CONFIG, { theme: { radius: 'big', accent: '#123456' }, foo: 1, quality: { maxHeight: null } });
  assert.equal(out.theme.radius, DEFAULT_CONFIG.theme.radius);
  assert.equal(out.theme.accent, '#123456');
  assert.equal((out as unknown as Record<string, unknown>).foo, undefined);
  assert.equal(out.quality.maxHeight, null);
  assert.equal(DEFAULT_CONFIG.theme.accent, '#ff3d3d'); // defaults are not mutated
});

test('channel theme wins over the viewer colours, viewer keeps the button size', () => {
  const cfg = resolveConfig({ theme: { accent: '#00ff00', controlSize: 'compact' } }, { theme: { accent: '#ff0000', controlSize: 'large' } });
  assert.equal(cfg.theme.accent, '#00ff00');
  assert.equal(cfg.theme.controlSize, 'large');
});

test('viewer can turn the channel theme off; author cannot change behaviour', () => {
  const author = { theme: { accent: '#00ff00' } };
  const off = resolveConfig(author, { theme: { accent: '#ff0000' }, behavior: { useAuthorTheme: false } });
  assert.equal(off.theme.accent, '#ff0000');
  const cfg = resolveConfig({ theme: { accent: '#00ff00' }, layout: { left: [] } } as never, null);
  assert.deepEqual(cfg.layout.left, DEFAULT_CONFIG.layout.left);
});

test('hotkey conflicts are detected', () => {
  assert.deepEqual(findConflicts(DEFAULT_CONFIG.hotkeys), []);
  assert.deepEqual(findConflicts({ ...DEFAULT_CONFIG.hotkeys, toggleMute: ['K'] }), ['k']);
});

test('thumbnail VTT: cues are parsed and found by time', () => {
  const cues = parseThumbsVtt(`WEBVTT

00:00:00.000 --> 00:00:02.000
sprite_000.jpg#xywh=0,0,160,90

00:00:02.000 --> 00:00:04.000
sprite_000.jpg#xywh=160,0,160,90
`, 'http://host/hls/thumbs.vtt');
  assert.equal(cues.length, 2);
  assert.equal(cues[1].url, 'http://host/hls/sprite_000.jpg');
  assert.equal(cueAt(cues, 3.5)?.x, 160);
  assert.equal(cueAt(cues, 0)?.x, 0);
});

test('default hotkeys have no conflicts; theater mode, resume and autoplay of the next video are on by default', () => {
  assert.deepEqual(findConflicts(DEFAULT_CONFIG.hotkeys), []);
  assert.ok(DEFAULT_CONFIG.layout.right.includes('theater'));
  assert.equal(DEFAULT_CONFIG.behavior.resume, true);
  assert.equal(DEFAULT_CONFIG.behavior.autoplayNext, true);
  const cfg = resolveConfig(null, { behavior: { resume: false } });
  assert.equal(cfg.behavior.resume, false);
  assert.equal(cfg.behavior.autoplayNext, true);
});

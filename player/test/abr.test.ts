import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveHybridRule, BufferRule, HybridRule, ThroughputRule, maxAllowedLevel, type AbrContext } from '../src/abr/algorithms';
import { ThroughputEstimator } from '../src/abr/ThroughputEstimator';
import type { Level } from '../src/streaming/m3u8';

const mbps = (x: number): number => x * 1e6;
const level = (index: number, height: number, bitrate: number): Level => ({
  index, url: '', bitrate, width: Math.round((height * 16) / 9), height, codecs: '', name: `${height}p`,
});
const LEVELS = [level(0, 360, mbps(0.9)), level(1, 480, mbps(1.5)), level(2, 720, mbps(2.9)), level(3, 1080, mbps(5.1))];
const ctx = (over: Partial<AbrContext>): AbrContext => ({
  levels: LEVELS, currentLevel: 1, throughput: mbps(4), buffer: 10, maxBuffer: 30, segmentDuration: 4,
  sinceSwitch: 20, maxAllowed: 3, mode: 'balanced', ...over,
});

test('throughput rule: highest level not above 0.85 of the estimate', () => {
  const r = new ThroughputRule();
  assert.equal(r.chooseLevel(ctx({ throughput: mbps(4) })), 2); // 0.85*4 = 3.4 >= 2.9
  assert.equal(r.chooseLevel(ctx({ throughput: mbps(3) })), 1); // 2.55 < 2.9
  assert.equal(r.chooseLevel(ctx({ throughput: 0 })), 0);
});

test('buffer rule (BBA): lowest in the reservoir, highest above the cushion', () => {
  const r = new BufferRule();
  assert.equal(r.chooseLevel(ctx({ buffer: 5 })), 0);
  assert.equal(r.chooseLevel(ctx({ buffer: 29 })), 3);
  const mid = r.chooseLevel(ctx({ buffer: 16 }));
  assert.ok(mid > 0 && mid < 3);
});

test('hybrid rule switches between throughput and buffer rules with hysteresis', () => {
  const r = new HybridRule();
  assert.equal(r.chooseLevel(ctx({ buffer: 4, throughput: mbps(4) })), 2); // throughput rule (β = 0.9)
  assert.equal(r.chooseLevel(ctx({ buffer: 29, throughput: mbps(1) })), 3); // buffer rule after B >= 10
});

test('adaptive hybrid: down-switch guard keeps the buffer reserve', () => {
  const r = new AdaptiveHybridRule();
  // 1080p segment takes 5.1*4/2 = 10.2 s at 2 Mbit/s: the buffer of 6 s would be drained.
  const next = r.chooseLevel(ctx({ currentLevel: 3, buffer: 6, throughput: mbps(2) }));
  assert.ok(next <= 1, `expected a fast down-switch, got ${next}`);
});

test('adaptive hybrid: up-switch after the hold time, one level unless the buffer is almost full', () => {
  const r = new AdaptiveHybridRule();
  assert.equal(r.chooseLevel(ctx({ currentLevel: 0, buffer: 15, throughput: mbps(20), sinceSwitch: 20 })), 1);
  assert.equal(r.chooseLevel(ctx({ currentLevel: 0, buffer: 25, throughput: mbps(20), sinceSwitch: 20 })), 3);
  assert.equal(r.chooseLevel(ctx({ currentLevel: 0, buffer: 25, throughput: mbps(20), sinceSwitch: 2 })), 0);
});

test('adaptive hybrid: a comfortable buffer absorbs a throughput drop', () => {
  const r = new AdaptiveHybridRule();
  assert.equal(r.chooseLevel(ctx({ currentLevel: 2, buffer: 25, throughput: mbps(2.5) })), 2);
  assert.equal(r.chooseLevel(ctx({ currentLevel: 2, buffer: 8, throughput: mbps(2.5) })), 1);
});

test('adaptive hybrid: a lasting drop is followed one level at a time', () => {
  const r = new AdaptiveHybridRule();
  // 1080p at 4 Mbit/s: 5.1 s per 4 s segment; 12 s of buffer allow one more segment but not two
  // (12 − 2·5.1 + 4 = 5.8 ≥ 4 → keep), with 10 s the next level is taken in advance.
  assert.equal(r.chooseLevel(ctx({ currentLevel: 3, buffer: 14, throughput: mbps(4) })), 3);
  assert.equal(r.chooseLevel(ctx({ currentLevel: 3, buffer: 10, throughput: mbps(4) })), 2);
});

test('adaptive hybrid: first segment uses the throughput candidate', () => {
  const r = new AdaptiveHybridRule();
  assert.equal(r.chooseLevel(ctx({ currentLevel: -1, buffer: 0, throughput: mbps(4) })), 1); // β_min = 0.6 → 2.4 Mbit/s
});

test('viewer limits: max resolution and data saver mode', () => {
  assert.equal(maxAllowedLevel(LEVELS, 720, 'balanced'), 2);
  assert.equal(maxAllowedLevel(LEVELS, null, 'eco'), 1);
  assert.equal(maxAllowedLevel(LEVELS, null, 'quality'), 3);
});

test('throughput estimator: bias-corrected EWMA, reacts to drops faster than to spikes', () => {
  const e = new ThroughputEstimator();
  assert.equal(e.estimate, 0);
  for (let i = 0; i < 6; i++) e.addSample(2_000_000, 4); // 4 Mbit/s
  assert.ok(Math.abs(e.estimate - mbps(4)) < mbps(0.05), `estimate ${e.estimate}`);
  e.addSample(500_000, 4); // a slow segment: 1 Mbit/s
  const afterDrop = e.estimate;
  assert.ok(afterDrop < mbps(3.2));
  e.addSample(10_000, 0.001); // tiny download is ignored
  assert.equal(e.estimate, afterDrop);
});

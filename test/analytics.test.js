const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  viewThreshold, parseReport, acceptedWatched, dayKey, lastDays, buildDaily, retentionCurve, parsePeriod,
} = require('../utils/analytics');

const id = '0123456789abcdef01234567';

test('analytics: report validation', () => {
  assert.deepEqual(parseReport({ video: id, session: 'abc-12345', watched: 12.5, buckets: [3, 1, 1, 2] }),
    { video: id, session: 'abc-12345', watched: 12.5, buckets: [1, 2, 3] });
  assert.equal(parseReport({ video: 'x', session: 'abc-12345', watched: 1, buckets: [] }), null);
  assert.equal(parseReport({ video: id, session: 'a b', watched: 1, buckets: [] }), null);
  assert.equal(parseReport({ video: id, session: 'abc-12345', watched: -1, buckets: [] }), null);
  assert.equal(parseReport({ video: id, session: 'abc-12345', watched: Infinity, buckets: [] }), null);
  assert.equal(parseReport({ video: id, session: 'abc-12345', watched: 1, buckets: [100] }), null);
  assert.equal(parseReport({ video: id, session: 'abc-12345', watched: 1, buckets: [1.5] }), null);
  assert.equal(parseReport(null), null);
});

test('analytics: a view needs 5 s of playback (half of a very short video)', () => {
  assert.equal(viewThreshold(600), 5);
  assert.equal(viewThreshold(6), 3);
  assert.equal(viewThreshold(0), 5);
});

test('analytics: watch time only grows and not faster than 2x real time', () => {
  assert.equal(acceptedWatched(40, 30, 15, 600), 40);
  assert.equal(acceptedWatched(20, 30, 15, 600), 30); // never decreases
  assert.equal(acceptedWatched(1000, 30, 15, 600), 30 + 15 * 2 + 30); // capped by elapsed time
  assert.equal(acceptedWatched(5000, 0, 1e6, 60), 1200); // at most 20 durations
});

test('analytics: days in a time zone, zero days filled, previous period', () => {
  const now = new Date('2026-10-13T23:30:00Z');
  assert.equal(dayKey(now, 'UTC'), '2026-10-13');
  assert.equal(dayKey(now, 'Europe/Kyiv'), '2026-10-14');
  assert.deepEqual(lastDays(3, now, 'UTC'), ['2026-10-11', '2026-10-12', '2026-10-13']);
  const rows = [
    { _id: '2026-10-13', views: 4, watched: 100, viewWatched: 96 },
    { _id: '2026-10-11', views: 1, watched: 10, viewWatched: 10 },
    { _id: '2026-10-09', views: 2, watched: 50, viewWatched: 50 }, // previous 3-day period
    { _id: '2026-09-01', views: 9, watched: 900, viewWatched: 900 }, // outside both
  ];
  const r = buildDaily(rows, 3, now, 'UTC');
  assert.deepEqual(r.daily.map((d) => d.views), [1, 0, 4]);
  assert.deepEqual(r.totals, { views: 5, watched: 110, viewWatched: 106 });
  assert.deepEqual(r.previous, { views: 2, watched: 50, viewWatched: 50 });
});

test('analytics: retention curve and period parsing', () => {
  const c = retentionCurve([{ _id: 0, n: 4 }, { _id: 50, n: 2 }, { _id: 99, n: 1 }], 4);
  assert.equal(c.length, 100);
  assert.equal(c[0], 1);
  assert.equal(c[50], 0.5);
  assert.equal(c[99], 0.25);
  assert.equal(c[10], 0);
  assert.deepEqual(retentionCurve([], 0), new Array(100).fill(0));
  assert.equal(parsePeriod('7'), 7);
  assert.equal(parsePeriod('90'), 90);
  assert.equal(parsePeriod('1000'), 28);
  assert.equal(parsePeriod(undefined), 28);
});

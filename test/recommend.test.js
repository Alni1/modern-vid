const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../utils/recommend');

const day = 86400000;
const now = Date.parse('2026-10-14T12:00:00Z');
const v = (id, title, extra = {}) => ({
  _id: id, title, description: '', tags: [], category: 'Education', user: 'u1', uploadedAt: new Date(now - 10 * day), ...extra,
});

test('recommend: tokenizer drops stop words and merges word forms', () => {
  assert.deepEqual(R.tokenize('Лекція 4: адаптивна потокова передача відео'), ['лекці', 'адапт', 'поток', 'перед']);
  assert.deepEqual(R.tokenize('лекції'), R.tokenize('лекцію'));
  assert.deepEqual(R.tokenize('The best video of 2026'), ['best']);
  assert.deepEqual(R.tokenize(null), []);
});

test('recommend: similar titles rank above unrelated ones', () => {
  const videos = [
    v('a', 'Адаптивна потокова передача відео: лекція 4'),
    v('b', 'Потокова передача HLS: лекція 5'),
    v('c', 'Захід сонця над Дніпром', { category: 'Entertainment', user: 'u2' }),
    v('d', 'Рецепт борщу', { user: 'u3' }),
  ];
  const rec = R.recommendAll(videos, { now }).get('a').map((r) => r.id);
  assert.equal(rec[0], 'b');
  assert.equal(rec[rec.length - 1], 'c'); // other channel, other category, no common words
});

test('recommend: watched share is smoothed towards the catalogue average', () => {
  const prior = 0.5;
  assert.ok(R.qualityScore({ views: 1, parts: 1 }, prior) < R.qualityScore({ views: 50, parts: 40 }, prior));
  assert.equal(R.qualityScore(undefined, prior), prior);
});

test('recommend: freshness halves every three weeks', () => {
  assert.equal(R.freshnessScore(new Date(now), now), 1);
  assert.ok(Math.abs(R.freshnessScore(new Date(now - 21 * day), now) - 0.5) < 1e-9);
});

test('recommend: co-watching is off without an audience and grows with it', () => {
  assert.equal(R.cowatchWeight(0), 0);
  assert.equal(R.cowatchWeight(10), R.A_MAX / 2);
  assert.equal(R.cowatchWeight(1000), R.A_MAX);
  assert.equal(R.cowatchScore(new Set(['x', 'y']), new Set(['y', 'z'])), 0.5);
  assert.equal(R.cowatchScore(new Set(), new Set(['y'])), 0);

  // 20 viewers of "a" also watched "c" (an unrelated title): with that audience "c" wins.
  const videos = [v('a', 'Лекція 1'), v('b', 'Лекція 2'), v('c', 'Котики')];
  const fans = new Set(Array.from({ length: 20 }, (_, i) => 'user' + i));
  const without = R.recommendAll(videos, { now }).get('a')[0].id;
  const withAudience = R.recommendAll(videos, { now, viewers: new Map([['a', fans], ['c', fans]]) }).get('a')[0].id;
  assert.equal(without, 'b');
  assert.equal(withAudience, 'c');
});

test('recommend: at most two videos of one channel among the first six', () => {
  const ranked = ['a1', 'a2', 'a3', 'a4', 'b1', 'c1', 'd1', 'e1'].map((id) => ({ id, ch: id[0] }));
  const out = R.diversify(ranked, (r) => r.ch).map((r) => r.id);
  assert.deepEqual(out, ['a1', 'a2', 'b1', 'c1', 'd1', 'e1', 'a3', 'a4']);
});

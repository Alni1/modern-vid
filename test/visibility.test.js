const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canWatch, isListed, LISTED, VISIBILITY } = require('../utils/visibility');
const { clean } = require('../middlewares/sanitize');

const author = { _id: 'a1', role: 'user' };
const stranger = { _id: 'u2', role: 'user' };
const moderator = { _id: 'm1', role: 'moderator' };

test('visibility: private videos are available only to the author and moderators', () => {
  const video = { visibility: 'private', user: { _id: 'a1' } };
  assert.equal(canWatch(author, video), true);
  assert.equal(canWatch(moderator, video), true);
  assert.equal(canWatch(stranger, video), false);
  assert.equal(canWatch(null, video), false);
  assert.equal(canWatch(null, { visibility: 'unlisted', user: 'a1' }), true);
  assert.equal(canWatch(null, { user: 'a1' }), true); // videos without the field are public
});

test('visibility: only public videos are listed', () => {
  assert.deepEqual(VISIBILITY, ['public', 'unlisted', 'private']);
  assert.equal(isListed({}), true);
  assert.equal(isListed({ visibility: 'public' }), true);
  assert.equal(isListed({ visibility: 'unlisted' }), false);
  assert.deepEqual(LISTED, { visibility: { $nin: ['unlisted', 'private'] } });
});

test('sanitize: MongoDB operators are removed from request data', () => {
  const body = { login: { $ne: null }, password: 'x', nested: { 'a.b': 1, ok: [{ $gt: 1, v: 2 }] } };
  assert.deepEqual(clean(body), { login: {}, password: 'x', nested: { ok: [{ v: 2 }] } });
});

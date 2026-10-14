const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../utils/moderation');

const u = (id, role = 'user', extra = {}) => ({ _id: id, role, ...extra });

test('moderation: who may manage whom', () => {
  const user = u('1'), user2 = u('2'), mod = u('3', 'moderator'), mod2 = u('4', 'moderator'), admin = u('5', 'admin'), admin2 = u('6', 'admin');
  assert.equal(M.canManageUser(user, user2), false); // ordinary users cannot
  assert.equal(M.canManageUser(mod, user), true);
  assert.equal(M.canManageUser(mod, mod2), false); // only an administrator restricts moderators
  assert.equal(M.canManageUser(mod, admin), false);
  assert.equal(M.canManageUser(admin, mod), true);
  assert.equal(M.canManageUser(admin, admin2), true);
  assert.equal(M.canManageUser(admin, admin), false); // never oneself
  assert.equal(M.canManageUser(mod, null), false);
});

test('moderation: roles and restrictions', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  assert.equal(M.isModerator(u('1')), false);
  assert.equal(M.isModerator(u('1', 'moderator')), true);
  assert.equal(M.isAdmin(u('1', 'moderator')), false);
  assert.equal(M.isModerator(u('1', 'admin')), true);
  assert.equal(M.isModerator(null), false);
  assert.equal(M.isBanned(u('1', 'user', { bannedUntil: new Date('2026-10-15') }), now), true);
  assert.equal(M.isBanned(u('1', 'user', { bannedUntil: new Date('2026-10-13') }), now), false);
  assert.equal(M.isBanned(u('1', 'user', { bannedUntil: null }), now), false);
  assert.equal(M.banEnd(7, now).toISOString(), '2026-10-21T12:00:00.000Z');
  assert.equal(M.banEnd(0, now), M.PERMANENT);
});

test('moderation: hidden content is visible to its author and to staff only', () => {
  assert.equal(M.canSeeHidden(u('1'), '1'), true);
  assert.equal(M.canSeeHidden(u('2'), '1'), false);
  assert.equal(M.canSeeHidden(u('2', 'moderator'), '1'), true);
  assert.equal(M.canSeeHidden(null, '1'), false);
});

test('moderation: report validation', () => {
  const id = '0123456789abcdef01234567';
  assert.deepEqual(M.parseReport({ targetType: 'video', target: id, reason: 'spam', note: '  link spam  ' }),
    { targetType: 'video', target: id, reason: 'spam', note: 'link spam' });
  assert.equal(M.parseReport({ targetType: 'user', target: id, reason: 'spam' }), null);
  assert.equal(M.parseReport({ targetType: 'comment', target: 'x', reason: 'spam' }), null);
  assert.equal(M.parseReport({ targetType: 'comment', target: id, reason: 'toString' }), null);
  assert.equal(M.parseReport({ targetType: 'comment', target: id, reason: 'other', note: 'a'.repeat(900) }).note.length, 500);
});

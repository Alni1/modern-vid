const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.SECRET_KEY = process.env.SECRET_KEY || 'test-secret';
const { signAccess, verifyAccess, safeNext, hashToken, ACCESS_TTL_SEC } = require('../utils/auth');

const id = '0123456789abcdef01234567';

test('auth: access tokens are short-lived and typed', () => {
  const token = signAccess(id);
  assert.equal(verifyAccess(token), id);
  const { exp, iat } = jwt.decode(token);
  assert.equal(exp - iat, ACCESS_TTL_SEC);
  assert.equal(ACCESS_TTL_SEC, 15 * 60);
});

test('auth: tokens of the first version and foreign tokens are rejected', () => {
  const s = process.env.SECRET_KEY;
  assert.equal(verifyAccess(jwt.sign({ id: 'uuid-of-user', login: 'alex' }, s)), null); // registration token without expiry
  assert.equal(verifyAccess(jwt.sign({ id }, s, { expiresIn: '7d' })), null); // old login token
  assert.equal(verifyAccess(jwt.sign({ sub: id, typ: 'access' }, 'another-secret')), null);
  assert.equal(verifyAccess(jwt.sign({ sub: id, typ: 'access', exp: Math.floor(Date.now() / 1000) - 10 }, s)), null);
  assert.equal(verifyAccess(jwt.sign({ sub: 'not-an-id', typ: 'access' }, s)), null);
  assert.equal(verifyAccess(undefined), null);
});

test('auth: return address after sign-in stays on this site', () => {
  assert.equal(safeNext('/userprofile#analytics'), '/userprofile#analytics');
  assert.equal(safeNext('/player/abc?t=1'), '/player/abc?t=1');
  assert.equal(safeNext('//evil.example'), '/');
  assert.equal(safeNext('/\\evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
  assert.equal(safeNext(undefined), '/');
});

test('auth: refresh tokens are stored as SHA-256 hashes', () => {
  assert.match(hashToken('abc'), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken('abc'), hashToken('abd'));
});

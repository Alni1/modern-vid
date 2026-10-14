const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loginError, displayNameError, normalizeLogin } = require('../utils/accounts');

test('accounts: a login is one word of Latin letters, digits, dots, underscores or hyphens', () => {
  for (const ok of ['alex', 'alex.konev', 'Alex_Konev', 'user-42', '007']) assert.equal(loginError(ok), null, ok);
  assert.match(loginError('Олексій Анатолійович Конєвіченко'), /one word/);
  assert.match(loginError('alex konev'), /one word/);
  assert.match(loginError('олексій'), /Latin/);
  assert.match(loginError('.alex'), /start/);
  assert.match(loginError('al'), /3–30/);
  assert.match(loginError('a'.repeat(31)), /3–30/);
  assert.equal(normalizeLogin('  Alex.Konev '), 'alex.konev');
});

test('accounts: the display name is free text on one line', () => {
  assert.equal(displayNameError('Олексій Анатолійович Конєвіченко'), null);
  assert.match(displayNameError('   '), /Enter/);
  assert.match(displayNameError('a'.repeat(51)), /50/);
  assert.match(displayNameError('two\nlines'), /one line/);
});

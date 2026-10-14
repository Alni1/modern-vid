// Rules for new accounts. A login is what a person types to sign in and appears in links and
// the moderation panel, so it is one word of Latin letters, digits, dots, underscores or hyphens.
// The display name is free text (any language, spaces allowed): it is what other people see.

const LOGIN_MIN = 3;
const LOGIN_MAX = 30;
const NAME_MAX = 50;
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Normalized login (trimmed, lower case) as it is stored. */
const normalizeLogin = (login) => String(login || '').trim().toLowerCase();

/** Returns an error message for an invalid login, or null. */
function loginError(login) {
  const l = normalizeLogin(login);
  if (/\s/.test(l)) return 'The login must be one word, without spaces. Put your full name into the display name.';
  if (l.length < LOGIN_MIN || l.length > LOGIN_MAX) return `The login must be ${LOGIN_MIN}–${LOGIN_MAX} characters long.`;
  if (!LOGIN_RE.test(l)) return 'The login may contain only Latin letters, digits, dots, underscores and hyphens, and must start with a letter or a digit.';
  return null;
}

/** Returns an error message for an invalid display name, or null. */
function displayNameError(name) {
  const n = String(name || '').trim();
  if (!n) return 'Enter a display name.';
  if (n.length > NAME_MAX) return `The display name can be at most ${NAME_MAX} characters.`;
  if (/[\r\n\t]/.test(n)) return 'The display name must be on one line.';
  return null;
}

module.exports = { LOGIN_MIN, LOGIN_MAX, NAME_MAX, normalizeLogin, loginError, displayNameError };

// Limits that can be changed in the environment (.env).

/** Maximum size of an uploaded video, MB (MAX_UPLOAD_MB, default 2048 = 2 GB). */
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 2048);

module.exports = {
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES: MAX_UPLOAD_MB * 1024 * 1024,
  /** Human-readable limit, e.g. "2 GB" or "500 MB". */
  maxUploadText: () => (MAX_UPLOAD_MB % 1024 === 0 ? `${MAX_UPLOAD_MB / 1024} GB` : `${MAX_UPLOAD_MB} MB`),
  /** Minimum password length. */
  MIN_PASSWORD: 8,
};

/**
 * Debug logging, off by default. Enable with DEBUG_LOGS=1 in .env.
 * Never enable in production: some debug messages contain tokens and user data.
 */
module.exports = function debug(...args) {
  if (process.env.DEBUG_LOGS === '1') console.log(...args);
};

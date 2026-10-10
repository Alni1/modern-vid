const path = require('path');
const LocalStorage = require('./LocalStorage');

/**
 * Storage factory. The driver is chosen with the STORAGE_DRIVER env variable:
 *   local (default) — files in LOCAL_STORAGE_DIR (default: <project>/storage), served at /media
 *   s3              — S3-compatible storage (Cloudflare R2 / Garage), added in the next stage
 *
 * Every driver implements: putFile(key, path, {move}), putBuffer(key, buffer), putDir(prefix, dir),
 * getLocalPath(key), delete(key), deletePrefix(prefix), getUrl(key), keyFromUrl(url), middleware().
 */
function createStorage() {
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  switch (driver) {
    case 'local':
      return new LocalStorage({
        root: process.env.LOCAL_STORAGE_DIR || path.join(__dirname, '..', '..', 'storage'),
        publicPath: '/media',
      });
    default:
      throw new Error(`Unsupported STORAGE_DRIVER "${driver}"`);
  }
}

module.exports = createStorage();

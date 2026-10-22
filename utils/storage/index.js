const path = require('path');
const LocalStorage = require('./LocalStorage');
const S3Storage = require('./S3Storage');

/**
 * Storage factory. The driver is chosen with the STORAGE_DRIVER env variable:
 *   local (default) — files in LOCAL_STORAGE_DIR (default: <project>/storage), served at /media
 *   s3              — S3-compatible storage (Backblaze B2, Cloudflare R2, MinIO, AWS S3):
 *                     S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *                     optional S3_PUBLIC_URL (public bucket/CDN), S3_MEDIA_MODE=redirect|proxy,
 *                     S3_DIRECT_UPLOAD=off to send uploads through the server
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
    case 's3':
      return new S3Storage({
        bucket: process.env.S3_BUCKET,
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || 'auto',
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
        publicUrl: process.env.S3_PUBLIC_URL || '',
        mediaMode: process.env.S3_MEDIA_MODE === 'proxy' ? 'proxy' : 'redirect',
        urlTtl: Number(process.env.S3_URL_TTL) || 3600,
      });
    default:
      throw new Error(`Unsupported STORAGE_DRIVER "${driver}"`);
  }
}

module.exports = createStorage();

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
  DeleteObjectsCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/** Content types of the files the platform stores (S3 does not guess them). */
const TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4',
  '.ts': 'video/mp2t', '.vtt': 'text/vtt; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
};
const typeOf = (key) => TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';
/** Playlists and text tracks change while a video is processed; everything else is immutable. */
const isMutable = (key) => /\.(m3u8|vtt)$/i.test(key);

/**
 * S3-compatible object storage (Backblaze B2, Cloudflare R2, MinIO, AWS S3).
 * Media keeps the same URLs as with the local driver (/media/<key>), so access checks for
 * private videos stay on the server: playlists and subtitles are proxied (small, must not be
 * cached), and the large files (segments, images) are answered with a redirect to a short-lived
 * pre-signed URL, so the video data goes from the bucket straight to the viewer.
 */
class S3Storage {
  constructor({ bucket, endpoint, region = 'auto', accessKeyId, secretAccessKey, forcePathStyle = true,
    publicUrl = '', mediaMode = 'redirect', urlTtl = 3600 }) {
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 storage needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    }
    this.name = 's3';
    this.bucket = bucket;
    this.publicPath = '/media';
    this.publicUrl = publicUrl.replace(/\/+$/, ''); // a public bucket or CDN in front of it (optional)
    this.mediaMode = mediaMode; // 'redirect' (default) or 'proxy' (everything through the server)
    this.urlTtl = urlTtl;
    this.client = new S3Client({
      region, endpoint: endpoint || undefined, forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
      // Checksums added by new SDK versions are not supported by every S3-compatible service.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  static clean(key) {
    const k = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!k || k.split('/').some((p) => p === '..' || p === '.')) throw new Error(`Invalid storage key: ${key}`);
    return k;
  }

  async putFile(key, sourcePath, { move = false } = {}) {
    const k = S3Storage.clean(key);
    const { size } = await fsp.stat(sourcePath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: k, Body: fs.createReadStream(sourcePath), ContentLength: size,
      ContentType: typeOf(k), CacheControl: isMutable(k) ? 'no-cache' : 'public, max-age=31536000, immutable',
    }));
    if (move) await fsp.unlink(sourcePath).catch(() => {});
    return k;
  }

  async putBuffer(key, buffer) {
    const k = S3Storage.clean(key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: k, Body: buffer, ContentType: typeOf(k),
      CacheControl: isMutable(k) ? 'no-cache' : 'public, max-age=31536000, immutable',
    }));
    return k;
  }

  /**
   * Uploads every file of a directory under the prefix. Playlists go last, so a viewer never
   * gets a playlist that references segments which are not uploaded yet.
   */
  async putDir(prefix, dir, { move = false } = {}) {
    const entries = await fsp.readdir(dir, { withFileTypes: true, recursive: true });
    const files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath || e.path, e.name));
    const rel = (f) => path.relative(dir, f).split(path.sep).join('/');
    const first = files.filter((f) => !isMutable(f));
    const last = files.filter((f) => isMutable(f)).sort((a, b) => (/master\.m3u8$/.test(a) ? 1 : 0) - (/master\.m3u8$/.test(b) ? 1 : 0));
    const run = async (list) => {
      let i = 0;
      const worker = async () => { while (i < list.length) { const f = list[i++]; await this.putFile(`${prefix}/${rel(f)}`, f, { move }); } };
      await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
    };
    await run(first);
    for (const f of last) await this.putFile(`${prefix}/${rel(f)}`, f, { move });
    return files.length;
  }

  /** Downloads the object into a temporary file (FFmpeg input); release() deletes it. */
  async getLocalPath(key) {
    const k = S3Storage.clean(key);
    const file = path.join(os.tmpdir(), `modernvid-${randomUUID()}${path.extname(k)}`);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: k }));
    await pipeline(out.Body, fs.createWriteStream(file));
    return { path: file, release: async () => { await fsp.rm(file, { force: true }); } };
  }

  async exists(key) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: S3Storage.clean(key) }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || (err.$metadata && err.$metadata.httpStatusCode === 404)) return false;
      throw err;
    }
  }

  async delete(key) {
    if (!key) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: S3Storage.clean(key) }));
  }

  /** Deletes every object under the prefix ("folder"). */
  async deletePrefix(prefix) {
    if (!prefix) return;
    const p = S3Storage.clean(prefix).replace(/\/?$/, '/');
    let token;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: p, ContinuationToken: token }));
      const keys = (page.Contents || []).map((o) => ({ Key: o.Key }));
      if (keys.length) {
        try {
          await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
        } catch (err) {
          // Some S3-compatible services lack the batch call: delete one by one.
          if (!/NotImplemented|MethodNotAllowed/i.test(err.name || '')) throw err;
          for (const o of keys) await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: o.Key }));
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  getUrl(key) {
    const encoded = String(key).split('/').map(encodeURIComponent).join('/');
    return `${this.publicPath}/${encoded}`;
  }

  keyFromUrl(url) {
    if (!url || !url.startsWith(this.publicPath + '/')) return null;
    return decodeURIComponent(url.slice(this.publicPath.length + 1));
  }

  /** A pre-signed GET URL (or the public URL when the bucket is public). */
  async readUrl(key, ttl = this.urlTtl) {
    const k = S3Storage.clean(key);
    if (this.publicUrl) return `${this.publicUrl}/${k.split('/').map(encodeURIComponent).join('/')}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: k }), { expiresIn: ttl });
  }

  // ---------------------------------------------------------------- direct multipart upload

  async createMultipart(key, contentType) {
    const k = S3Storage.clean(key);
    const r = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: k, ContentType: contentType || typeOf(k) }));
    return r.UploadId;
  }

  /** Pre-signed URL the browser PUTs one part to (the bucket CORS must expose the ETag header). */
  presignPart(key, uploadId, partNumber, ttl = 6 * 3600) {
    return getSignedUrl(this.client, new UploadPartCommand({ Bucket: this.bucket, Key: S3Storage.clean(key), UploadId: uploadId, PartNumber: partNumber }), { expiresIn: ttl });
  }

  async completeMultipart(key, uploadId, parts) {
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket, Key: S3Storage.clean(key), UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: S3Storage.clean(key) }));
    return { size: head.ContentLength || 0 };
  }

  async abortMultipart(key, uploadId) {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: S3Storage.clean(key), UploadId: uploadId }));
  }

  // ---------------------------------------------------------------- serving

  /** Streams an object through the server (playlists, subtitles, or everything in proxy mode). */
  async proxy(key, req, res) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: req.headers.range, IfNoneMatch: req.headers['if-none-match'] }));
      res.status(out.ContentRange ? 206 : 200);
      res.setHeader('Content-Type', out.ContentType || typeOf(key));
      if (out.ContentLength !== undefined) res.setHeader('Content-Length', out.ContentLength);
      if (out.ContentRange) res.setHeader('Content-Range', out.ContentRange);
      if (out.ETag) res.setHeader('ETag', out.ETag);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', isMutable(key) ? 'no-cache' : 'public, max-age=3600');
      if (req.method === 'HEAD') { out.Body.destroy?.(); return res.end(); }
      await pipeline(out.Body, res);
    } catch (err) {
      const status = err.$metadata && err.$metadata.httpStatusCode;
      if (status === 304) return res.status(304).end();
      if (status === 404 || err.name === 'NoSuchKey') return res.status(404).send('Not found');
      if (status === 416) return res.status(416).end();
      if (!res.headersSent) res.status(502).send('Storage error');
      else res.destroy(err);
    }
  }

  /** Express handler for /media/<key>. */
  middleware() {
    return (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      let key;
      try {
        key = S3Storage.clean(decodeURIComponent(req.path));
      } catch {
        return res.status(400).send('Bad request');
      }
      if (this.mediaMode === 'proxy' || isMutable(key)) return this.proxy(key, req, res);
      // The redirect may be cached a little shorter than the signature lives.
      this.readUrl(key).then((url) => {
        res.setHeader('Cache-Control', `private, max-age=${Math.max(60, this.urlTtl - 600)}`);
        res.redirect(302, url);
      }, next);
    };
  }
}

module.exports = S3Storage;

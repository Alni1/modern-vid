const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const verifyToken = require('../middlewares/verifyToken');
const { requireActiveUser } = require('../middlewares/roles');
const storage = require('../utils/storage');
const { probe, makeThumbnail } = require('../utils/ffmpeg');
const { enqueue } = require('../utils/transcoder/worker');
const rateLimit = require('express-rate-limit');
const { MAX_UPLOAD_BYTES, maxUploadText } = require('../utils/limits');
const { VISIBILITY } = require('../utils/visibility');
const { parseChapters } = require('../utils/chapters');

const router = express.Router();

const TEMP_DIR = path.join(__dirname, '../temp_uploads');
const MAX_SIZE = MAX_UPLOAD_BYTES; // MAX_UPLOAD_MB in .env, 2 GB by default

/** At most 20 uploads per hour from one address. */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Try again later.' },
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
      cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) return cb(new Error('Only video files are allowed'));
    cb(null, true);
  },
});

/** Checks the file, makes the thumbnail and creates the video record; the source is already stored. */
async function finishUpload(req, { videoId, sourceKey, size, mimetype, input }) {
  const thumbName = `${videoId}.jpg`;
  const tempThumb = path.join(TEMP_DIR, thumbName);
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  let local = null; // a downloaded copy of the source when FFmpeg cannot read it by URL
  const read = async (fn) => {
    try {
      return await fn(input);
    } catch (err) {
      if (!/^https?:/.test(input) || local) throw err;
      local = await storage.getLocalPath(sourceKey);
      input = local.path;
      return fn(input);
    }
  };
  try {
    // Make sure the file really is a playable video (not only by its MIME type).
    let duration = 0;
    try {
      const info = await read(probe);
      if (!info.streams.some((s) => s.codec_type === 'video')) throw new Error('no video stream');
      duration = Number(info.format.duration) || 0;
    } catch (probeErr) {
      const e = new Error('The file is not a valid video');
      e.status = 400; e.details = probeErr.message;
      throw e;
    }
    await read((src) => makeThumbnail(src, TEMP_DIR, thumbName, { at: Math.min(1, duration / 2) }));
    const thumbKey = await storage.putFile(`videos/${videoId}/thumb.jpg`, tempThumb, { move: true });

    const { title, description, tags, category } = req.body;
    const visibility = VISIBILITY.includes(req.body.visibility) ? req.body.visibility : 'public';
    const ch = parseChapters(req.body.chapters, duration);
    if (ch.error) {
      const e = new Error(`Chapters: ${ch.error}`);
      e.status = 400;
      throw e;
    }
    const newVideo = new VideoMeta({
      videoId,
      title,
      description,
      tags: tags ? String(tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
      size,
      duration,
      contentType: mimetype,
      storageDriver: storage.name,
      storageKey: sourceKey,
      thumbnailKey: thumbKey,
      thumbnailUrl: storage.getUrl(thumbKey),
      status: 'processing',
      processingProgress: 0,
      user: req.user._id,
      category,
      visibility,
      chapters: ch.chapters,
    });
    await newVideo.save();
    await User.findByIdAndUpdate(req.user._id, { $push: { videos: newVideo._id } });
    await enqueue(newVideo._id); // HLS transcoding runs in the background
    return newVideo;
  } finally {
    fs.promises.rm(tempThumb, { force: true }).catch(() => {});
    if (local) await local.release().catch(() => {});
  }
}

const failUpload = async (res, err, videoId) => {
  await storage.deletePrefix(`videos/${videoId}`).catch(() => {});
  if (err.status === 400) return res.status(400).json({ error: err.message, details: err.details });
  console.error('[UPLOAD] failed:', err);
  res.status(500).json({ error: 'Failed to upload video', details: err.message });
};

// Upload through the server (local storage, or S3 with S3_DIRECT_UPLOAD=off).
router.post('/', uploadLimiter, requireActiveUser, (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `File too large. Max size is ${maxUploadText()}.` });
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  const tempVideo = req.file.path;
  const videoId = randomUUID();
  try {
    const ext = path.extname(req.file.filename) || '.mp4';
    // The file is checked before it is moved into the storage.
    const sourceKey = `videos/${videoId}/source${ext}`;
    let video;
    try {
      await probe(tempVideo);
    } catch (probeErr) {
      return res.status(400).json({ error: 'The file is not a valid video', details: probeErr.message });
    }
    await storage.putFile(sourceKey, tempVideo, { move: true });
    video = await finishUpload(req, { videoId, sourceKey, size: req.file.size, mimetype: req.file.mimetype, input: await sourceInput(sourceKey) });
    res.status(201).json({ message: 'Video uploaded successfully', videoId: video._id, thumbnailUrl: video.thumbnailUrl });
  } catch (error) {
    await failUpload(res, error, videoId);
  } finally {
    fs.promises.rm(tempVideo, { force: true }).catch(() => {});
  }
});

/** What FFmpeg reads the stored source from: the local file or a short-lived URL. */
async function sourceInput(key) {
  if (storage.name === 'local') return storage.resolve(key);
  return storage.readUrl(key, 3600);
}

// ---------------------------------------------------------------- direct upload to the bucket
// The browser uploads the file in parts straight to S3 by pre-signed URLs; the server only
// signs the parts and finishes the upload, so large files do not pass through it.

const DIRECT = storage.name === 's3' && process.env.S3_DIRECT_UPLOAD !== 'off';
const PART_SIZE = 16 * 1024 * 1024; // 16 MB (S3 needs at least 5 MB per part, at most 10 000 parts)
const PENDING_TTL = 24 * 60 * 60 * 1000;
const pending = new Map(); // videoId -> { user, key, uploadId, size, type, at }

/** Unfinished uploads older than a day are aborted, so the bucket keeps no orphaned parts. */
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (now - p.at < PENDING_TTL) continue;
    pending.delete(id);
    storage.abortMultipart(p.key, p.uploadId).catch(() => {});
  }
}, 60 * 60 * 1000).unref();

function ownPending(req, res) {
  const p = pending.get(req.params.id);
  if (!p || String(p.user) !== String(req.user._id)) {
    res.status(404).json({ error: 'Upload not found or expired' });
    return null;
  }
  return p;
}

router.get('/config', requireActiveUser, (req, res) => {
  res.json({ direct: DIRECT, partSize: PART_SIZE, maxBytes: MAX_SIZE });
});

router.post('/multipart', uploadLimiter, requireActiveUser, async (req, res, next) => {
  if (!DIRECT) return res.status(404).json({ error: 'Direct upload is not enabled' });
  try {
    const size = Number(req.body && req.body.size);
    const type = String((req.body && req.body.type) || '');
    const name = String((req.body && req.body.name) || 'video.mp4');
    if (!type.startsWith('video/')) return res.status(400).json({ error: 'Only video files are allowed' });
    if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: 'Empty file' });
    if (size > MAX_SIZE) return res.status(400).json({ error: `File too large. Max size is ${maxUploadText()}.` });
    const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.mp4'])[0];
    const videoId = randomUUID();
    const key = `videos/${videoId}/source${ext}`;
    const uploadId = await storage.createMultipart(key, type);
    pending.set(videoId, { user: req.user._id, key, uploadId, size, type, at: Date.now() });
    res.status(201).json({ id: videoId, partSize: PART_SIZE, parts: Math.ceil(size / PART_SIZE) });
  } catch (err) {
    next(err);
  }
});

// Pre-signed URLs for a batch of parts (at most 100 per request).
router.post('/multipart/:id/urls', requireActiveUser, async (req, res, next) => {
  const p = ownPending(req, res);
  if (!p) return;
  try {
    const total = Math.ceil(p.size / PART_SIZE);
    const numbers = [...new Set((req.body && req.body.parts) || [])].map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= total).slice(0, 100);
    const urls = {};
    for (const n of numbers) urls[n] = await storage.presignPart(p.key, p.uploadId, n);
    res.json({ urls });
  } catch (err) {
    next(err);
  }
});

router.post('/multipart/:id/complete', requireActiveUser, async (req, res) => {
  const p = ownPending(req, res);
  if (!p) return;
  pending.delete(req.params.id);
  const videoId = req.params.id;
  try {
    const parts = ((req.body && req.body.parts) || [])
      .map((x) => ({ partNumber: Number(x.partNumber), etag: String(x.etag || '') }))
      .filter((x) => Number.isInteger(x.partNumber) && x.etag)
      .sort((a, b) => a.partNumber - b.partNumber);
    if (parts.length !== Math.ceil(p.size / PART_SIZE)) {
      await storage.abortMultipart(p.key, p.uploadId).catch(() => {});
      return res.status(400).json({ error: 'Some parts of the file were not uploaded' });
    }
    const { size } = await storage.completeMultipart(p.key, p.uploadId, parts);
    if (size > MAX_SIZE) {
      const e = new Error(`File too large. Max size is ${maxUploadText()}.`);
      e.status = 400;
      throw e;
    }
    const video = await finishUpload(req, { videoId, sourceKey: p.key, size, mimetype: p.type, input: await sourceInput(p.key) });
    res.status(201).json({ message: 'Video uploaded successfully', videoId: video._id, thumbnailUrl: video.thumbnailUrl });
  } catch (error) {
    await failUpload(res, error, videoId);
  }
});

router.delete('/multipart/:id', requireActiveUser, async (req, res) => {
  const p = ownPending(req, res);
  if (!p) return;
  pending.delete(req.params.id);
  await storage.abortMultipart(p.key, p.uploadId).catch(() => {});
  res.json({ ok: true });
});

// The upload form is a dialog on the profile page.
router.get('/', verifyToken, (req, res) => res.redirect('/userprofile#upload'));

module.exports = router;

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const verifyToken = require('../middlewares/verifyToken');
const storage = require('../utils/storage');
const { probe, makeThumbnail } = require('../utils/ffmpeg');

const router = express.Router();

const TEMP_DIR = path.join(__dirname, '../temp_uploads');
const MAX_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB (direct multipart upload to storage comes later)

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

router.post('/', verifyToken, (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max size is 1GB.' });
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

  const tempVideo = req.file.path;
  const videoId = randomUUID();
  const thumbName = `${videoId}.jpg`;
  const tempThumb = path.join(TEMP_DIR, thumbName);

  try {
    // Make sure the file really is a playable video (not only by its MIME type).
    let duration = 0;
    try {
      const info = await probe(tempVideo);
      if (!info.streams.some((s) => s.codec_type === 'video')) throw new Error('no video stream');
      duration = Number(info.format.duration) || 0;
    } catch (probeErr) {
      return res.status(400).json({ error: 'The file is not a valid video', details: probeErr.message });
    }

    await makeThumbnail(tempVideo, TEMP_DIR, thumbName, { at: Math.min(1, duration / 2) });

    const ext = path.extname(req.file.filename) || '.mp4';
    const videoKey = await storage.putFile(`videos/${videoId}/source${ext}`, tempVideo, { move: true });
    const thumbKey = await storage.putFile(`videos/${videoId}/thumb.jpg`, tempThumb, { move: true });

    const { title, description, tags, category } = req.body;
    const newVideo = new VideoMeta({
      videoId,
      title,
      description,
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      size: req.file.size,
      duration,
      contentType: req.file.mimetype,
      storageDriver: storage.name,
      storageKey: videoKey,
      thumbnailKey: thumbKey,
      thumbnailUrl: storage.getUrl(thumbKey),
      user: req.user._id,
      category,
    });
    await newVideo.save();
    await User.findByIdAndUpdate(req.user._id, { $push: { videos: newVideo._id } });

    res.status(201).json({ message: 'Video uploaded successfully', videoId: newVideo._id, thumbnailUrl: newVideo.thumbnailUrl });
  } catch (error) {
    console.error('[UPLOAD] failed:', error);
    await storage.deletePrefix(`videos/${videoId}`).catch(() => {});
    res.status(500).json({ error: 'Failed to upload video', details: error.message });
  } finally {
    for (const f of [tempVideo, tempThumb]) fs.promises.rm(f, { force: true }).catch(() => {});
  }
});

router.get('/', verifyToken, (req, res) => {
  res.render('uploadPage', { user: req.user, query: req.query.q || '' });
});

module.exports = router;

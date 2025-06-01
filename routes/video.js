const express = require('express');
const router = express.Router();
const { getStorage, ref, getDownloadURL, getMetadata } = require('firebase/storage');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const VideoCache = require('../models/VideoCache');
const { firebaseStorage } = require('../app');
const rateLimit = require('express-rate-limit');

const storage = firebaseStorage; 

const VideoMeta = require('../schemas/VideoMeta'); 

async function getVideoStream(videoId) {
  const cached = await VideoCache.findOne({ videoId });
  const videoRef = ref(storage, `videos/${videoId}`);

  if (cached) {
    cached.lastAccessed = new Date();
    cached.expiresAt = new Date(Date.now() + 3600000);
    await cached.save();

    return {
      videoUrl: await getDownloadURL(videoRef),
      contentLength: cached.contentLength,
      contentType: cached.contentType
    };
  }

  const metadata = await getMetadata(videoRef);
  const videoUrl = await getDownloadURL(videoRef);

  await VideoCache.create({
    videoId,
    contentLength: metadata.size,
    contentType: metadata.contentType
  });

  return {
    videoUrl,
    contentLength: metadata.size,
    contentType: metadata.contentType
  };
}

router.get('/', (req, res) => {
  const videoId = 'your-video.mp4'; 
  res.render('player', {
    videoUrl: `/video/${videoId}`
  });
});

const Video = require('../schemas/Video');

const { ref, getDownloadURL } = require('firebase/storage');
const { firebaseStorage } = require('../app');

const playerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

router.get('/player/:id', playerRateLimiter, async (req, res) => {
  try {
    const videoData = await Video.findOne({ videoId: req.params.id });
    if (!videoData) return res.status(404).send('Video not found');
    const videoRef = ref(firebaseStorage, `videos/${videoData.videoId}`);
    const videoUrl = await getDownloadURL(videoRef);
    res.render('player', {
      title: videoData.title,
      description: videoData.description,
      videoUrl
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
  const metadata = await getMetadata(videoRef);
  const videoUrl = await getDownloadURL(videoRef);

  await VideoCache.create({
    videoId,
    contentLength: metadata.size,
    contentType: metadata.contentType
  });

  return {
    videoUrl,
    contentLength: metadata.size,
    contentType: metadata.contentType
  };


router.get('/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const range = req.headers.range;

    const { videoUrl, contentLength, contentType } = await getVideoStream(videoId);

    if (range) {
      const [start, endRaw] = range.replace(/bytes=/, '').split('-');
      const startByte = parseInt(start, 10);
      const endByte = endRaw ? parseInt(endRaw, 10) : contentLength - 1;
      const chunkSize = endByte - startByte + 1;

      const headers = {
        'Content-Range': `bytes ${startByte}-${endByte}/${contentLength}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      };

      res.writeHead(206, headers);

      const response = await fetch(videoUrl, {
        headers: { Range: `bytes=${startByte}-${endByte}` }
      });

      response.body.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': contentLength,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      });

      const response = await fetch(videoUrl);
      response.body.pipe(res);
    }
  } catch (err) {
    console.error('Video stream error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

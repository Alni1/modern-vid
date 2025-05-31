const express = require('express');
const router = express.Router();
const { getStorage, ref, getDownloadURL, getMetadata } = require('firebase/storage');
const mongoose = require('mongoose');
const fetch = require('node-fetch'); // npm i node-fetch
const VideoCache = require('../models/VideoCache');
const { firebaseStorage } = require('../app');
const rateLimit = require('express-rate-limit'); // npm i express-rate-limit

const storage = firebaseStorage; 

const VideoMeta = require('../schemas/VideoMeta'); 

// Helper function to get video stream and cache metadata
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

// schema import to output video metadata

const Video = require('../schemas/Video');

// firebase instrumentation import to access video files
const { ref, getDownloadURL } = require('firebase/storage');
const { firebaseStorage } = require('../app');

// route to show player with metadata
const playerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requests per windowMs
});

router.get('/player/:id', playerRateLimiter, async (req, res) => {
  try {
    // Find video metadata by ID
    const videoData = await Video.findOne({ videoId: req.params.id });
    if (!videoData) return res.status(404).send('Video not found');
    // Get video URL from Firebase Storage
    const videoRef = ref(firebaseStorage, `videos/${videoData.videoId}`);
    const videoUrl = await getDownloadURL(videoRef);
    // Render EJS template with video metadata
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

const express = require('express');
const multer = require('multer');
const { ref, uploadBytes, getDownloadURL } = require('firebase/storage');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const verifyToken = require('../middlewares/verifyToken');
const { firebaseStorage } = require('../firebase-init'); 

const router = express.Router();

const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(__dirname, '../temp_uploads'); 
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: diskStorage, 
  limits: { fileSize: 1 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    console.log('[MULTER_DEBUG] File filter. Mimetype:', file.mimetype);
    if (!file.mimetype.startsWith('video/')) {
      console.log('[MULTER_DEBUG] File is not a video. Rejecting.');
      return cb(new Error('Only video files are allowed'));
    }
    cb(null, true);
  }
});

router.post('/', verifyToken, (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('[MULTER_ERROR] Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Max size is 1GB.' }); 
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    } else if (err) {
      console.error('[UPLOAD_ERROR] Non-Multer error during upload middleware:', err);
      return res.status(400).json({ error: err.message });
    }

    console.log('[MULTER_DEBUG] Multer processed file successfully. Calling next route handler.');
    next();
  });
}, async (req, res) => { 
  console.log('[UPLOAD_DEBUG] Received request to /upload (after Multer).');
  let tempFilePath = null; 
  let thumbnailPath = null; 
  const tempDir = path.join(__dirname, '../temp');

  try {
    console.log('[UPLOAD_DEBUG] Inside try block.');
    if (!fs.existsSync(tempDir)) {
      console.log('[UPLOAD_DEBUG] Temp directory does not exist. Creating:', tempDir);
      fs.mkdirSync(tempDir, { recursive: true });
    }

    if (!req.file) {
      console.log('[UPLOAD_DEBUG] No video file uploaded.');
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    console.log('[UPLOAD_DEBUG] req.file:', JSON.stringify(req.file, (key, value) => key === 'buffer' ? 'Buffer(omitted)' : value));
    console.log('[UPLOAD_DEBUG] req.body:', JSON.stringify(req.body));


    const { path: uploadedVideoPath, originalname, mimetype, filename: multerFileName } = req.file;
    const { title, description, tags, category } = req.body; 
    const userId = req.user._id; 
    console.log(`[UPLOAD_DEBUG] User ID: ${userId}, Title: ${title}`);
    console.log(`[UPLOAD_DEBUG] Multer saved video to: ${uploadedVideoPath}`);

    const firebaseVideoFileName = multerFileName; 
    console.log(`[UPLOAD_DEBUG] Firebase video fileName: ${firebaseVideoFileName}`);
    
   
    console.log('[UPLOAD_DEBUG] Attempting to upload video to Firebase from disk (readFileSync)...');
    if (!firebaseStorage) { 
      console.error('[UPLOAD_DEBUG] firebaseStorage (imported from firebase-init.js) is not initialized. Cannot upload video.');
      throw new Error('Firebase Storage not available');
    }
    
    console.log(`[UPLOAD_DEBUG] Reading file into buffer: ${uploadedVideoPath}`);
    const videoFileBuffer = fs.readFileSync(uploadedVideoPath); 
    console.log(`[UPLOAD_DEBUG] File read into buffer. Size: ${videoFileBuffer.length} bytes.`);

    const videoRef = ref(firebaseStorage, `videos/${firebaseVideoFileName}`);
    console.log(`[UPLOAD_DEBUG] Created videoRef: videos/${firebaseVideoFileName}`);
    
    console.log('[UPLOAD_DEBUG] Starting uploadBytes for video...');
    await uploadBytes(videoRef, videoFileBuffer, { contentType: mimetype }); 
    console.log('[UPLOAD_DEBUG] Video uploaded to Firebase successfully via uploadBytes.');
    
    const videoUrl = await getDownloadURL(videoRef);
    console.log(`[UPLOAD_DEBUG] Got video download URL: ${videoUrl}`);

    tempFilePath = uploadedVideoPath;
    console.log(`[UPLOAD_DEBUG] Generating thumbnail from: ${tempFilePath}`);
    const thumbnailName = `${uuidv4()}.jpg`;
    thumbnailPath = path.join(tempDir, thumbnailName);
    
    await new Promise((resolve, reject) => {
      ffmpeg(tempFilePath)
        .screenshots({
          timestamps: [1],
          filename: thumbnailName,
          folder: path.join(__dirname, '../temp'),
          size: '320x180'
        })
        .on('end', () => {
          console.log('[UPLOAD_DEBUG] Thumbnail generated successfully.');
          resolve();
        })
        .on('error', (err) => {
          console.error('[UPLOAD_DEBUG] ffmpeg error:', err);
          reject(err);
        });
    });

    console.log(`[UPLOAD_DEBUG] Reading thumbnail into buffer: ${thumbnailPath}`);
    const thumbnailBuffer = fs.readFileSync(thumbnailPath);
    console.log(`[UPLOAD_DEBUG] Thumbnail read into buffer. Size: ${thumbnailBuffer.length} bytes.`);

    const thumbnailRef = ref(firebaseStorage, `thumbnails/${thumbnailName}`); 
    console.log(`[UPLOAD_DEBUG] Created thumbnailRef: thumbnails/${thumbnailName}`);

    console.log('[UPLOAD_DEBUG] Starting uploadBytes for thumbnail...');
    await uploadBytes(thumbnailRef, thumbnailBuffer, { contentType: 'image/jpeg' }); 
    console.log('[UPLOAD_DEBUG] Thumbnail uploaded to Firebase successfully via uploadBytes.');

    const thumbnailUrl = await getDownloadURL(thumbnailRef); 
    console.log(`[UPLOAD_DEBUG] Got thumbnail download URL: ${thumbnailUrl}`);

    console.log('[UPLOAD_DEBUG] Attempting to save video metadata to MongoDB...');
    const newVideo = new VideoMeta({
      videoId: firebaseVideoFileName, 
      title,
      description,
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      contentType: mimetype, 
      firebasePath: `videos/${firebaseVideoFileName}`, 
      thumbnailUrl,
      user: userId,
      category 
    });

    await newVideo.save();
    console.log('[UPLOAD_DEBUG] Video metadata saved to MongoDB.');
    await User.findByIdAndUpdate(userId, { $push: { videos: newVideo._id } });
    console.log('[UPLOAD_DEBUG] User document updated with new video ID.');

    res.status(201).json({
      message: 'Video uploaded successfully',
      videoId: newVideo._id,
      thumbnailUrl
    });
    console.log('[UPLOAD_DEBUG] Response sent to client.');
  } catch (error) {
    console.error('[UPLOAD_DEBUG] Catch block error:', error); 
    res.status(500).json({ error: 'Failed to upload video', details: error.message });
  } finally {
    if (tempFilePath) {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log('Successfully deleted Multer temp video file:', tempFilePath); 
        }
      } catch (e) {
        console.error('Failed to delete Multer temp video file:', tempFilePath, e);
      }
    }
    
    if (thumbnailPath && fs.existsSync(thumbnailPath)) {
      
      if (thumbnailPath !== tempFilePath) {
          try {
            fs.unlinkSync(thumbnailPath);
            console.log('Successfully deleted ffmpeg temp thumbnail file:', thumbnailPath);
          } catch (e) {
            console.error('Failed to delete ffmpeg temp thumbnail file:', thumbnailPath, e);
          }
      } else {
        console.log('[UPLOAD_DEBUG] thumbnailPath is the same as tempFilePath, not deleting thumbnail separately to avoid double deletion.');
      }
    } else if (thumbnailPath) {
        console.log('[UPLOAD_DEBUG] ffmpeg temp thumbnail file not found at:', thumbnailPath);
      }
    } 
});

router.get('/', verifyToken, (req, res) => { 
  res.render('uploadPage', {
    user: req.user, 
    query: req.query.q || '' 
  });
});

module.exports = router;

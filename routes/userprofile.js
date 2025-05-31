const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');
const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const multer = require('multer');
const path = require('path');
const { firebaseStorage } = require('../firebase-init'); // Import Firebase Storage instance
const { ref, deleteObject, uploadBytes, getDownloadURL } = require('firebase/storage'); // Import Firebase Storage functions

// Настройка multer для аватарок (используем memoryStorage для Firebase)
const avatarStorage = multer.memoryStorage(); // Store files in memory for Firebase upload
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB limit for avatars
});

const videoStorage = multer.diskStorage({
  destination: './public/uploads/videos/',
  filename: (req, file, cb) => {
    // Используем req.user._id, так как verifyToken теперь загружает полного пользователя
    if (!req.user || !req.user._id) {
      // Обработка случая, если req.user или req.user._id отсутствует
      // Это не должно происходить, если verifyToken отработал правильно
      return cb(new Error("User not authenticated or user ID is missing for video filename"));
    }
    cb(null, `video_${Date.now()}_${req.user._id}${path.extname(file.originalname)}`);
  }
});
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB limit for videos
});

// GET профиль пользователя
router.get('/', verifyToken, async (req, res) => {
  console.log('[USERPROFILE_ROUTE_DEBUG] Entered /userprofile GET handler.');
  console.log('[USERPROFILE_ROUTE_DEBUG] req.user from verifyToken:', JSON.stringify(req.user, null, 2));

  // Используем req.user._id, так как это стандартное поле ID из MongoDB
  if (!req.user || !req.user._id) {
    console.log('[USERPROFILE_ROUTE_DEBUG] req.user or req.user._id is missing after verifyToken. This should not happen. Redirecting.');
    return res.clearCookie('token').redirect('/login');
  }

  try {
    // Используем req.user._id для поиска
    console.log('[USERPROFILE_ROUTE_DEBUG] Attempting to find user in DB with ID:', req.user._id);
    const userFromDB = await User.findById(req.user._id).populate('videos').lean();
    
    if (!userFromDB) {
      // Используем req.user._id в логе
      console.log('[USERPROFILE_ROUTE_DEBUG] User not found in DB within route handler for ID:', req.user._id, '. Clearing cookie and redirecting.');
      return res.clearCookie('token').redirect('/login');
    }
    console.log('[USERPROFILE_ROUTE_DEBUG] User successfully fetched from DB in route handler.');
    console.log('[USERPROFILE_ROUTE_DEBUG] userFromDB after populate, before lean (raw Mongoose doc):', userFromDB); // Log before .lean() if possible, or just the lean object
    console.log('[USERPROFILE_ROUTE_DEBUG] userFromDB.videos after populate:', JSON.stringify(userFromDB ? userFromDB.videos : "userFromDB is null", null, 2));
    console.log('[USERPROFILE_ROUTE_DEBUG] Type of userFromDB.videos:', userFromDB ? typeof userFromDB.videos : "userFromDB is null");
    if(userFromDB && Array.isArray(userFromDB.videos)) {
      userFromDB.videos.forEach((video, index) => {
        console.log(`[USERPROFILE_ROUTE_DEBUG] Video ${index}:`, JSON.stringify(video, null, 2));
        console.log(`[USERPROFILE_ROUTE_DEBUG] Video ${index} _id:`, video._id);
        console.log(`[USERPROFILE_ROUTE_DEBUG] Video ${index} title:`, video.title);
        console.log(`[USERPROFILE_ROUTE_DEBUG] Video ${index} thumbnailUrl:`, video.thumbnailUrl);
      });
    }

    // Гарантируем, что videos — массив
    // Проверяем, что userFromDB существует перед доступом к userFromDB.videos
    if (userFromDB && !Array.isArray(userFromDB.videos)) {
      userFromDB.videos = [];
    }
    
    // Передаем userFromDB в рендер
    res.render('userprofile', { user: userFromDB, title: 'User Profile', query: req.query.q || '' });
  } catch (err) {
    console.error('Error loading user profile:', err);
    res.status(500).send('Internal Server Error');
  }
});

// POST загрузка аватара
router.post('/avatar', verifyToken, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');

    // Firebase Storage upload
    const avatarFileName = `avatars/${req.user._id}${path.extname(req.file.originalname)}`;
    const avatarRef = ref(firebaseStorage, avatarFileName);

    // Metadata for the file
    const metadata = {
      contentType: req.file.mimetype,
    };

    // Upload file buffer
    await uploadBytes(avatarRef, req.file.buffer, metadata);

    // Get download URL
    const avatarUrl = await getDownloadURL(avatarRef);

    // TODO: Consider deleting old avatar from Firebase if it exists

    // Используем req.user._id
    await User.findByIdAndUpdate(req.user._id, { avatarUrl: avatarUrl }); // Save Firebase URL
    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error uploading avatar to Firebase:', err);
    res.status(500).send('Internal Server Error');
  }
});

// POST загрузка видео
router.post('/upload', verifyToken, videoUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No video uploaded');

    const newVideo = new VideoMeta({
      videoId: req.file.filename,
      title: req.body.title || 'Untitled',
      description: req.body.description || '',
      contentType: req.file.mimetype,
      user: req.user._id, // Используем req.user._id
      uploadedAt: new Date()
    });

    const savedVideo = await newVideo.save();

    await User.findByIdAndUpdate(req.user._id, { $push: { videos: savedVideo._id } }); // Используем req.user._id

    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error uploading video:', err);
    res.status(500).send('Internal Server Error');
  }
});

// POST удалить видео
router.post('/video/delete/:videoId', verifyToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user._id; // Используем req.user._id

    // Find the video metadata to get Firebase paths
    const video = await VideoMeta.findOne({ _id: videoId, user: userId });

    if (!video) {
      // If video not found or doesn't belong to the user
      return res.status(404).send('Video not found or access denied');
    }

    // Delete video from Firebase Storage
    if (video.firebasePath) {
      try {
        const videoFileRef = ref(firebaseStorage, video.firebasePath);
        await deleteObject(videoFileRef);
        console.log(`Successfully deleted video from Firebase: ${video.firebasePath}`);
      } catch (fbError) {
        console.error(`Error deleting video from Firebase (${video.firebasePath}):`, fbError);
        // Decide if you want to stop the process or just log the error
      }
    }

    // Delete thumbnail from Firebase Storage
    // Assuming thumbnailUrl is a full URL, we need to extract the path
    if (video.thumbnailUrl) {
      try {
        // Extract path from URL (e.g., https://firebasestorage.googleapis.com/v0/b/your-bucket.appspot.com/o/thumbnails%2Fthumbnail.jpg?alt=media -> thumbnails/thumbnail.jpg)
        const urlParts = video.thumbnailUrl.split('/o/');
        if (urlParts.length > 1) {
          const encodedPath = urlParts[1].split('?')[0];
          const thumbnailPath = decodeURIComponent(encodedPath); // Decode URL encoding (e.g., %2F -> /)
          const thumbnailFileRef = ref(firebaseStorage, thumbnailPath);
          await deleteObject(thumbnailFileRef);
          console.log(`Successfully deleted thumbnail from Firebase: ${thumbnailPath}`);
        }
      } catch (fbError) {
        console.error(`Error deleting thumbnail from Firebase (${video.thumbnailUrl}):`, fbError);
         // Decide if you want to stop the process or just log the error
      }
    }

    // Delete video metadata from MongoDB
    await VideoMeta.deleteOne({ _id: videoId, user: userId });
    // Remove video reference from user's video list
    await User.findByIdAndUpdate(userId, { $pull: { videos: videoId } });

    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).send('Internal Server Error');
  }
});

// POST удалить пользователя
router.post('/deleteUser', verifyToken, async (req, res) => {
  try {
    const userId = req.user._id; // Используем req.user._id

    // Find all videos by the user
    const videosToDelete = await VideoMeta.find({ user: userId });

    for (const video of videosToDelete) {
      // Delete video from Firebase Storage
      if (video.firebasePath) {
        try {
          const videoFileRef = ref(firebaseStorage, video.firebasePath);
          await deleteObject(videoFileRef);
          console.log(`Successfully deleted video from Firebase during user deletion: ${video.firebasePath}`);
        } catch (fbError) {
          console.error(`Error deleting video from Firebase (${video.firebasePath}) during user deletion:`, fbError);
          // Optionally, collect errors and decide if the process should halt
        }
      }

      // Delete thumbnail from Firebase Storage
      if (video.thumbnailUrl) {
        try {
          const urlParts = video.thumbnailUrl.split('/o/');
          if (urlParts.length > 1) {
            const encodedPath = urlParts[1].split('?')[0];
            const thumbnailPath = decodeURIComponent(encodedPath);
            const thumbnailFileRef = ref(firebaseStorage, thumbnailPath);
            await deleteObject(thumbnailFileRef);
            console.log(`Successfully deleted thumbnail from Firebase during user deletion: ${thumbnailPath}`);
          }
        } catch (fbError) {
          console.error(`Error deleting thumbnail from Firebase (${video.thumbnailUrl}) during user deletion:`, fbError);
          // Optionally, collect errors
        }
      }
    }

    // Delete all video metadata for the user from MongoDB
    await VideoMeta.deleteMany({ user: userId });

    // Delete the user from MongoDB
    await User.findByIdAndDelete(userId);

    res.clearCookie('token');
    res.redirect('/');
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

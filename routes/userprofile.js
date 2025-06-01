const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');
const VideoMeta = require('../schemas/VideoMeta');
const User = require('../schemas/userSchema');
const multer = require('multer');
const path = require('path');
const { firebaseStorage } = require('../firebase-init'); 
const { ref, deleteObject, uploadBytes, getDownloadURL } = require('firebase/storage'); 

const avatarStorage = multer.memoryStorage(); 
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 } 
});

const videoStorage = multer.diskStorage({
  destination: './public/uploads/videos/',
  filename: (req, file, cb) => {
    
    if (!req.user || !req.user._id) {
      
      return cb(new Error("User not authenticated or user ID is missing for video filename"));
    }
    cb(null, `video_${Date.now()}_${req.user._id}${path.extname(file.originalname)}`);
  }
});
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 } 
});


router.get('/', verifyToken, async (req, res) => {
  console.log('[USERPROFILE_ROUTE_DEBUG] Entered /userprofile GET handler.');
  console.log('[USERPROFILE_ROUTE_DEBUG] req.user from verifyToken:', JSON.stringify(req.user, null, 2));

  
  if (!req.user || !req.user._id) {
    console.log('[USERPROFILE_ROUTE_DEBUG] req.user or req.user._id is missing after verifyToken. This should not happen. Redirecting.');
    return res.clearCookie('token').redirect('/login');
  }

  try {
   
    console.log('[USERPROFILE_ROUTE_DEBUG] Attempting to find user in DB with ID:', req.user._id);
    const userFromDB = await User.findById(req.user._id).populate('videos').lean();
    
    if (!userFromDB) {
      
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

    
    if (userFromDB && !Array.isArray(userFromDB.videos)) {
      userFromDB.videos = [];
    }
    
    
    res.render('userprofile', { user: userFromDB, title: 'User Profile', query: req.query.q || '' });
  } catch (err) {
    console.error('Error loading user profile:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/avatar', verifyToken, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');

    
    const avatarFileName = `avatars/${req.user._id}${path.extname(req.file.originalname)}`;
    const avatarRef = ref(firebaseStorage, avatarFileName);


    const metadata = {
      contentType: req.file.mimetype,
    };

   
    await uploadBytes(avatarRef, req.file.buffer, metadata);

    
    const avatarUrl = await getDownloadURL(avatarRef);

    

    
    await User.findByIdAndUpdate(req.user._id, { avatarUrl: avatarUrl }); 
    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error uploading avatar to Firebase:', err);
    res.status(500).send('Internal Server Error');
  }
});


router.post('/upload', verifyToken, videoUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No video uploaded');

    const newVideo = new VideoMeta({
      videoId: req.file.filename,
      title: req.body.title || 'Untitled',
      description: req.body.description || '',
      contentType: req.file.mimetype,
      user: req.user._id, 
      uploadedAt: new Date()
    });

    const savedVideo = await newVideo.save();

    await User.findByIdAndUpdate(req.user._id, { $push: { videos: savedVideo._id } }); 

    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error uploading video:', err);
    res.status(500).send('Internal Server Error');
  }
});


router.post('/video/delete/:videoId', verifyToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user._id; 

    
    const video = await VideoMeta.findOne({ _id: videoId, user: userId });

    if (!video) {
      
      return res.status(404).send('Video not found or access denied');
    }

    
    if (video.firebasePath) {
      try {
        const videoFileRef = ref(firebaseStorage, video.firebasePath);
        await deleteObject(videoFileRef);
        console.log(`Successfully deleted video from Firebase: ${video.firebasePath}`);
      } catch (fbError) {
        console.error(`Error deleting video from Firebase (${video.firebasePath}):`, fbError);
      }
    }

    if (video.thumbnailUrl) {
      try {
        const urlParts = video.thumbnailUrl.split('/o/');
        if (urlParts.length > 1) {
          const encodedPath = urlParts[1].split('?')[0];
          const thumbnailPath = decodeURIComponent(encodedPath); 
          const thumbnailFileRef = ref(firebaseStorage, thumbnailPath);
          await deleteObject(thumbnailFileRef);
          console.log(`Successfully deleted thumbnail from Firebase: ${thumbnailPath}`);
        }
      } catch (fbError) {
        console.error(`Error deleting thumbnail from Firebase (${video.thumbnailUrl}):`, fbError);
      }
    }
    await VideoMeta.deleteOne({ _id: videoId, user: userId });
    await User.findByIdAndUpdate(userId, { $pull: { videos: videoId } });

    res.redirect('/userprofile');
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/deleteUser', verifyToken, async (req, res) => {
  try {
    const userId = req.user._id; 

    const videosToDelete = await VideoMeta.find({ user: userId });

    for (const video of videosToDelete) {
      if (video.firebasePath) {
        try {
          const videoFileRef = ref(firebaseStorage, video.firebasePath);
          await deleteObject(videoFileRef);
          console.log(`Successfully deleted video from Firebase during user deletion: ${video.firebasePath}`);
        } catch (fbError) {
          console.error(`Error deleting video from Firebase (${video.firebasePath}) during user deletion:`, fbError);
        }
      }
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
        }
      }
    }
    await VideoMeta.deleteMany({ user: userId });
    await User.findByIdAndDelete(userId);

    res.clearCookie('token');
    res.redirect('/');
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;

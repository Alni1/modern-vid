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
// const app = require('../app'); // No longer import app instance
const { firebaseStorage } = require('../firebase-init'); // Import firebaseStorage directly

const router = express.Router();

// Настройка diskStorage для Multer
const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(__dirname, '../temp_uploads'); // Используем другую временную папку для Multer
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
  storage: diskStorage, // Используем diskStorage вместо memoryStorage
  limits: { fileSize: 1 * 1024 * 1024 * 1024 }, // 1GB limit
  fileFilter: (req, file, cb) => {
    console.log('[MULTER_DEBUG] File filter. Mimetype:', file.mimetype);
    if (!file.mimetype.startsWith('video/')) {
      console.log('[MULTER_DEBUG] File is not a video. Rejecting.');
      return cb(new Error('Only video files are allowed'));
    }
    cb(null, true);
  }
});

// Firebase initialization is now done in app.js
// const firebaseConfig = { ... };
// let firebaseAppInstance;
// let firebaseStorageInstance; // This will be replaced by the imported firebaseStorage

//  POST /upload protected route for video upload JWT
router.post('/', verifyToken, (req, res, next) => {
  // Промежуточный обработчик для вызова Multer и логирования ошибок
  upload.single('video')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('[MULTER_ERROR] Multer error:', err);
      // Ошибки Multer, например, файл слишком большой
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Max size is 1GB.' }); // Correct error message
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    } else if (err) {
      // Другие ошибки (например, от fileFilter)
      console.error('[UPLOAD_ERROR] Non-Multer error during upload middleware:', err);
      return res.status(400).json({ error: err.message });
    }
    // Если ошибок нет, передаем управление основному обработчику
    console.log('[MULTER_DEBUG] Multer processed file successfully. Calling next route handler.');
    next();
  });
}, async (req, res) => { // Это теперь основной обработчик после Multer
  console.log('[UPLOAD_DEBUG] Received request to /upload (after Multer).');
  let tempFilePath = null; // Declare here for finally block access
  let thumbnailPath = null; // Declare here for finally block access
  const tempDir = path.join(__dirname, '../temp');

  try {
    console.log('[UPLOAD_DEBUG] Inside try block.');
    // Ensure the temporary directory exists
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


    // Теперь req.file содержит path, filename, originalname, mimetype, size, но НЕ buffer
    const { path: uploadedVideoPath, originalname, mimetype, filename: multerFileName } = req.file;
    const { title, description, tags, category } = req.body; // Added category
    const userId = req.user._id; // Corrected to use _id
    console.log(`[UPLOAD_DEBUG] User ID: ${userId}, Title: ${title}`);
    console.log(`[UPLOAD_DEBUG] Multer saved video to: ${uploadedVideoPath}`);

    // Имя файла для Firebase и VideoMeta (можно использовать multerFileName или сгенерировать новое)
    const firebaseVideoFileName = multerFileName; // Используем имя файла от Multer
    console.log(`[UPLOAD_DEBUG] Firebase video fileName: ${firebaseVideoFileName}`);
    
    // Revert to fs.readFileSync and client SDK's uploadBytes
    console.log('[UPLOAD_DEBUG] Attempting to upload video to Firebase from disk (readFileSync)...');
    if (!firebaseStorage) { // Check imported firebaseStorage
      console.error('[UPLOAD_DEBUG] firebaseStorage (imported from firebase-init.js) is not initialized. Cannot upload video.');
      throw new Error('Firebase Storage not available');
    }
    
    console.log(`[UPLOAD_DEBUG] Reading file into buffer: ${uploadedVideoPath}`);
    const videoFileBuffer = fs.readFileSync(uploadedVideoPath); // This will load the entire file into memory
    console.log(`[UPLOAD_DEBUG] File read into buffer. Size: ${videoFileBuffer.length} bytes.`);

    const videoRef = ref(firebaseStorage, `videos/${firebaseVideoFileName}`); // Use imported firebaseStorage
    console.log(`[UPLOAD_DEBUG] Created videoRef: videos/${firebaseVideoFileName}`);
    
    console.log('[UPLOAD_DEBUG] Starting uploadBytes for video...');
    await uploadBytes(videoRef, videoFileBuffer, { contentType: mimetype }); // Use imported firebaseStorage
    console.log('[UPLOAD_DEBUG] Video uploaded to Firebase successfully via uploadBytes.');
    
    const videoUrl = await getDownloadURL(videoRef); // Corrected: Use getDownloadURL
    console.log(`[UPLOAD_DEBUG] Got video download URL: ${videoUrl}`);

    // Генерируем превью
    // tempFilePath теперь будет uploadedVideoPath (файл, сохраненный Multer)
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

    // Upload thumbnail using readFileSync and uploadBytes
    console.log(`[UPLOAD_DEBUG] Reading thumbnail into buffer: ${thumbnailPath}`);
    const thumbnailBuffer = fs.readFileSync(thumbnailPath);
    console.log(`[UPLOAD_DEBUG] Thumbnail read into buffer. Size: ${thumbnailBuffer.length} bytes.`);

    const thumbnailRef = ref(firebaseStorage, `thumbnails/${thumbnailName}`); // Use imported firebaseStorage
    console.log(`[UPLOAD_DEBUG] Created thumbnailRef: thumbnails/${thumbnailName}`);

    console.log('[UPLOAD_DEBUG] Starting uploadBytes for thumbnail...');
    await uploadBytes(thumbnailRef, thumbnailBuffer, { contentType: 'image/jpeg' }); // Use imported firebaseStorage
    console.log('[UPLOAD_DEBUG] Thumbnail uploaded to Firebase successfully via uploadBytes.');

    const thumbnailUrl = await getDownloadURL(thumbnailRef); // Corrected: Use getDownloadURL
    console.log(`[UPLOAD_DEBUG] Got thumbnail download URL: ${thumbnailUrl}`);

    // Временные файлы будут удалены в блоке finally

    // Сохраняем метаданные в MongoDB
    console.log('[UPLOAD_DEBUG] Attempting to save video metadata to MongoDB...');
    const newVideo = new VideoMeta({
      videoId: firebaseVideoFileName, // Используем имя файла, которое пошло в Firebase
      title,
      description,
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      contentType: mimetype, // mimetype из req.file
      firebasePath: `videos/${firebaseVideoFileName}`, // Путь в Firebase
      thumbnailUrl,
      user: userId,
      category // Added category
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
    console.error('[UPLOAD_DEBUG] Catch block error:', error); // More specific log
    res.status(500).json({ error: 'Failed to upload video', details: error.message });
  } finally {
    if (tempFilePath) {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log('Successfully deleted Multer temp video file:', tempFilePath); // tempFilePath это uploadedVideoPath
        }
      } catch (e) {
        console.error('Failed to delete Multer temp video file:', tempFilePath, e);
      }
    }
    // thumbnailPath - это путь к превью, созданному ffmpeg в папке ../temp
    // tempFilePath (который равен uploadedVideoPath) - это путь к видео, сохраненному Multer в ../temp_uploads
    // Важно удалять оба, если они существуют и РАЗНЫЕ.
    if (thumbnailPath && fs.existsSync(thumbnailPath)) {
      // Проверяем, что thumbnailPath существует перед попыткой удаления
      // и что он не тот же самый файл, что и tempFilePath (хотя в данном случае они должны быть разными)
      if (thumbnailPath !== tempFilePath) {
          try {
            fs.unlinkSync(thumbnailPath);
            console.log('Successfully deleted ffmpeg temp thumbnail file:', thumbnailPath);
          } catch (e) {
            console.error('Failed to delete ffmpeg temp thumbnail file:', thumbnailPath, e);
          }
      } else {
        // Этого не должно произойти, если thumbnailPath указывает на файл в ../temp, а tempFilePath на файл в ../temp_uploads
        console.log('[UPLOAD_DEBUG] thumbnailPath is the same as tempFilePath, not deleting thumbnail separately to avoid double deletion.');
      }
    } else if (thumbnailPath) {
        console.log('[UPLOAD_DEBUG] ffmpeg temp thumbnail file not found at:', thumbnailPath);
      }
    } // Эта скобка закрывает блок finally
  // Удаляем лишнюю фигурную скобку и точку с запятой отсюда
}); // Эта скобка закрывает router.post(...)

// GET /upload download page
router.get('/', verifyToken, (req, res) => { // Added verifyToken to ensure req.user exists
  res.render('uploadPage', {
    user: req.user, // Pass the user object
    query: req.query.q || '' // Pass the query string or an empty string
  });
});

module.exports = router;

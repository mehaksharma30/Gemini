import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import { sendMessage, sendEmergency, getThread } from '../controllers/walkieTalkie.controller';

const router = Router();

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `wt_${timestamp}_${sanitizedName}`;
    cb(null, filename);
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Accept audio files (WAV, M4A, MP3)
  const allowedTypes = [
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/m4a',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
  ];

  // Also accept based on file extension
  const allowedExtensions = ['.wav', '.m4a', '.mp3', '.mp4'];
  const fileExt = path.extname(file.originalname).toLowerCase();

  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

// POST /api/wt/message
// Accept audio (multipart/form-data) or text (JSON)
// Handle both Content-Types properly
router.post('/message', authMiddleware, (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  
  // If JSON, skip multer (Express will parse JSON)
  if (contentType.includes('application/json')) {
    req.file = undefined;
    next();
  } else {
    // If multipart, use multer
    upload.single('audio')(req, res, next);
  }
}, sendMessage);

// POST /api/wt/emergency
// Accept audio (multipart/form-data)
router.post('/emergency', authMiddleware, upload.single('audio'), sendEmergency);

// GET /api/wt/thread/:threadId
// Get message history for a thread
router.get('/thread/:threadId', authMiddleware, getThread);

export default router;


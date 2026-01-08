import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import { sendMessage, getThread, pollMessages, getAudio } from '../controllers/walkieTalkie.controller';

const router = Router();

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    // Ensure directory exists
    if (!require('fs').existsSync(uploadDir)) {
      require('fs').mkdirSync(uploadDir, { recursive: true });
    }
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

// POST /api/wt/send
// Upload audio message from one user to another
// Body: multipart/form-data with fromUserId, toUserId, threadId (optional), clientTimestamp (optional), audio (file)
router.post('/send', authMiddleware, upload.single('audio'), sendMessage);

// GET /api/wt/thread?userA=<id>&userB=<id>
// Get thread between two users (all messages)
router.get('/thread', authMiddleware, getThread);

// GET /api/wt/poll?threadId=<id>&after=<timestamp or messageId>
// Get new messages in a thread after a specific timestamp or messageId
router.get('/poll', authMiddleware, pollMessages);

// GET /api/wt/audio/:messageId
// Serve audio file for a message
router.get('/audio/:messageId', authMiddleware, getAudio);

export default router;


import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { aiChat } from '../controllers/ai.controller';
import { panicChat } from '../controllers/aiPanic.controller';
import { transcribeAudio } from '../controllers/speech.controller';
import { textToSpeech, ttsValidation } from '../controllers/tts.controller';
import { getSpeechToken } from '../controllers/voice.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// Configure multer for audio file uploads (temporary storage)
const upload = multer({ 
  dest: path.join(process.cwd(), 'tmp'),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

router.get('/speech/token', getSpeechToken);
router.post('/chat', aiChat);
router.post('/panic-chat', panicChat);
router.post('/speech/transcribe', upload.single('audio'), transcribeAudio);
router.post('/tts', ttsValidation, textToSpeech);

export default router;

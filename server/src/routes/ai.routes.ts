import { Router } from 'express';
import { aiChat } from '../controllers/ai.controller';
import { panicChat } from '../controllers/aiPanic.controller';
import { getSpeechToken } from '../controllers/speech.controller';
import { textToSpeech, ttsValidation } from '../controllers/tts.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.post('/chat', aiChat);
router.post('/panic-chat', panicChat);
router.get('/speech/token', getSpeechToken);
router.post('/tts', ttsValidation, textToSpeech);

export default router;

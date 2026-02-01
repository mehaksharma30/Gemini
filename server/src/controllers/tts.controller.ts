import { Request, Response } from 'express';
import { synthesizeToMp3 } from '../services/googleTts.service';
import { body, validationResult } from 'express-validator';

/**
 * POST /api/ai/tts
 * Synthesize text to speech and return MP3 audio
 */
export const textToSpeech = async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: 'Invalid request', details: errors.array() });
      return;
    }

    const { text, lang } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required and must be a string' });
      return;
    }

    // Always use English (Hindi support removed)
    const detectedLang = lang || 'en';

    console.log(`[TTS] Request received - Text: "${text.substring(0, 50)}...", Lang: ${detectedLang}`);

    // Synthesize to MP3
    const audioBuffer = await synthesizeToMp3(text, detectedLang);

    // Set response headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`[TTS] Sending MP3 audio - Size: ${audioBuffer.length} bytes`);

    // Send audio buffer
    res.send(audioBuffer);
  } catch (error: any) {
    console.error('[TTS] Error:', error);
    res.status(500).json({
      error: 'Failed to synthesize speech',
      message: error.message || 'Unknown error',
    });
  }
};

/**
 * Validation rules for TTS endpoint
 */
export const ttsValidation = [
  body('text')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Text is required')
    .isLength({ max: 2000 })
    .withMessage('Text must not exceed 2000 characters'),
  body('lang')
    .optional()
    .isString()
    .withMessage('Language must be a string'),
];


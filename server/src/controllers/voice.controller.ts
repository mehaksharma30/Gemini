import { Request, Response } from 'express';

/**
 * Speech token endpoint for frontend compatibility.
 * This app uses Google Cloud Speech (STT/TTS) via the backend; no browser-side Azure token is used.
 * Returns available: false so clients can use server-side /api/ai/speech/transcribe and /api/ai/tts instead.
 */
export const getSpeechToken = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.status(200).json({
      success: true,
      available: false,
      message: 'Speech uses Google Cloud via backend; use /api/ai/speech/transcribe and /api/ai/tts',
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Voice] Token error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to get speech token',
    });
  }
};





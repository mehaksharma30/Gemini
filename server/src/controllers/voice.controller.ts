import { Request, Response } from 'express';
import { getSpeechConfig } from '../services/azureSpeech.service';

/**
 * Get Azure Speech token for frontend
 * In production, this should generate a time-limited token
 */
export const getSpeechToken = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const subscriptionKey = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION || 'eastus';

    if (!subscriptionKey) {
      return res.status(503).json({ 
        error: 'Azure Speech not configured',
        available: false 
      });
    }

    // Return token info (in production, generate actual token)
    return res.status(200).json({
      success: true,
      subscriptionKey,
      region,
      language: process.env.AZURE_SPEECH_LANGUAGE || 'en-US',
      voiceName: process.env.AZURE_SPEECH_VOICE || 'en-US-JennyNeural',
    });
  } catch (error: any) {
    console.error('[Voice] Token error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to get speech token',
    });
  }
};




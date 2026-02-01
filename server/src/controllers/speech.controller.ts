import { Request, Response } from 'express';
import https from 'https';
import { promises as fsPromises } from 'fs';
import { transcribeAudio as googleTranscribe } from '../services/googleSpeech.service';

/**
 * Get Azure Speech token for frontend
 * This endpoint generates a time-limited token from Azure Speech Service
 */
export const getSpeechToken = async (req: Request, res: Response) => {
  try {
    console.log('[Speech Token] Request received');
    
    if (!req.user) {
      console.warn('[Speech Token] Unauthorized - no user in request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const subscriptionKey = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION || 'eastus';

    console.log('[Speech Token] Config check - Key exists:', !!subscriptionKey, 'Region:', region);

    if (!subscriptionKey) {
      console.error('[Speech Token] Azure Speech key not configured');
      return res.status(503).json({ 
        error: 'Azure Speech not configured',
        available: false 
      });
    }

    // Request token from Azure Speech Service
    const tokenUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
    
    return new Promise<void>((resolve) => {
      const options = {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': subscriptionKey,
          'Content-Length': '0',
        },
      };

      const httpsReq = https.request(tokenUrl, options, (azureResponse) => {
        let token = '';

        azureResponse.on('data', (chunk) => {
          token += chunk.toString();
        });

        azureResponse.on('end', () => {
          if (azureResponse.statusCode === 200 && token) {
            console.log('[Speech Token] Token generated successfully');
            res.status(200).json({
              token,
              region,
              expiresIn: 600, // Azure tokens expire in ~10 minutes
            });
            resolve();
          } else {
            console.error('[Speech Token] Azure returned status:', azureResponse.statusCode);
            res.status(500).json({
              error: 'Failed to get Azure Speech token',
              statusCode: azureResponse.statusCode,
            });
            resolve();
          }
        });
      });

      httpsReq.on('error', (error) => {
        console.error('[Speech Token] Request error:', error);
        res.status(500).json({
          error: 'Failed to request Azure Speech token',
          details: error.message,
        });
        resolve();
      });

      httpsReq.end();
    });
  } catch (error: any) {
    console.error('[Speech Token] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to get speech token',
    });
  }
};

/**
 * Transcribe audio file to text using Google Cloud Speech-to-Text
 * Endpoint: POST /api/ai/speech/transcribe
 * Input: multipart/form-data with field 'audio' (WAV file, 16kHz mono)
 * Output: { text: string }
 */
export const transcribeAudio = async (req: Request, res: Response): Promise<void> => {
  const tempFilePath = req.file?.path;
  
  try {
    console.log('[Speech Transcribe] Request received');
    
    if (!req.user) {
      console.warn('[Speech Transcribe] Unauthorized - no user in request');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Check if audio file was uploaded
    if (!req.file) {
      console.warn('[Speech Transcribe] No audio file provided');
      res.status(400).json({ error: 'Missing audio file' });
      return;
    }

    // Get language from request body (default to en-US)
    const lang = (req.body && req.body.lang) ? req.body.lang : 'en-US';
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPath) {
      console.error('[Speech Transcribe] GOOGLE_APPLICATION_CREDENTIALS not set');
      res.status(500).json({ error: 'Speech env missing (GOOGLE_APPLICATION_CREDENTIALS)' });
      return;
    }

    console.log('[Speech Transcribe] Processing audio file:', req.file.originalname);
    console.log('[Speech Transcribe] Language:', lang);

    const wav = await fsPromises.readFile(req.file.path);
    const languageCode = lang === 'en-US' ? 'en-US' : lang;

    console.log('[Speech Transcribe] Calling Google Speech-to-Text...');

    let text: string;
    try {
      text = await googleTranscribe(Buffer.from(wav), languageCode);
    } catch (err: any) {
      console.error('[Speech Transcribe] Google STT error:', err?.message ?? err);
      res.status(502).json({
        error: 'STT failed',
        details: err?.message ?? 'Transcription failed',
      });
      return;
    }

    if (!text || !text.trim()) {
      console.warn('[Speech Transcribe] No speech detected in audio');
      res.status(400).json({ error: 'No speech detected' });
      return;
    }

    console.log('[Speech Transcribe] Transcription successful:', text.substring(0, 50) + '...');
    res.json({ text: text.trim() });
  } catch (error: any) {
    console.error('[Speech Transcribe] Error:', error);
    
    // Only send error response if not already sent
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error.message || 'STT failed' 
      });
    }
  } finally {
    // CRITICAL: Always cleanup temp file (success or error)
    if (tempFilePath) {
      try {
        await fsPromises.unlink(tempFilePath);
        console.log('[Speech Transcribe] Temp file cleaned up');
      } catch (unlinkError: any) {
        // Log but don't throw - cleanup failure shouldn't break the response
        console.warn('[Speech Transcribe] Failed to cleanup temp file:', unlinkError.message);
      }
    }
  }
};


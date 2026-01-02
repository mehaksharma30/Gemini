import { Request, Response } from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';

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
 * Transcribe audio file to text using Azure Speech-to-Text
 * Endpoint: POST /api/ai/speech/transcribe
 * Input: multipart/form-data with field 'audio' (WAV file, 16kHz mono)
 * Output: { text: string }
 */
export const transcribeAudio = async (req: Request, res: Response): Promise<void> => {
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
    const region = process.env.AZURE_SPEECH_REGION || 'eastus';
    const key = process.env.AZURE_SPEECH_KEY;

    if (!key) {
      console.error('[Speech Transcribe] Azure Speech key not configured');
      // Cleanup temp file
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: 'Azure speech env missing' });
      return;
    }

    console.log('[Speech Transcribe] Processing audio file:', req.file.originalname);
    console.log('[Speech Transcribe] Language:', lang, 'Region:', region);

    // Read the uploaded audio file
    const wav = fs.readFileSync(req.file.path);

    // Construct Azure Speech-to-Text API URL
    const url =
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(lang)}&format=simple`;

    console.log('[Speech Transcribe] Calling Azure STT API...');

    // Call Azure Speech-to-Text API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Accept': 'application/json',
      },
      body: wav,
    });

    // Parse response
    const json = await response.json() as { DisplayText?: string; RecognitionStatus?: string };

    // Cleanup temp file
    fs.unlink(req.file.path, () => {
      console.log('[Speech Transcribe] Temp file cleaned up');
    });

    // Extract text from response
    const text = (json && json.DisplayText) ? json.DisplayText : '';

    if (!text.trim()) {
      console.warn('[Speech Transcribe] No speech detected in audio');
      res.status(400).json({ error: 'No speech detected' });
      return;
    }

    console.log('[Speech Transcribe] Transcription successful:', text.substring(0, 50) + '...');
    res.json({ text });
  } catch (error: any) {
    console.error('[Speech Transcribe] Error:', error);
    
    // Cleanup temp file on error
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    
    res.status(500).json({ 
      error: error.message || 'STT failed' 
    });
  }
};


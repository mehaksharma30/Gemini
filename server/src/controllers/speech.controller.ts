import { Request, Response } from 'express';
import https from 'https';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

// Ensure fetch is available (Node 18+ has built-in fetch, otherwise use polyfill)
// TypeScript-safe fetch implementation
const getFetch = (): typeof fetch => {
  if (typeof fetch !== 'undefined') {
    return fetch;
  }
  // Fallback for Node < 18 - try to use node-fetch if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const nodeFetch = require('node-fetch');
    return nodeFetch.default || nodeFetch;
  } catch {
    throw new Error('fetch is not available. Please use Node.js 18+ or install node-fetch: npm install node-fetch');
  }
};

const fetchImpl = getFetch();

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
    const region = process.env.AZURE_SPEECH_REGION || 'eastus';
    const key = process.env.AZURE_SPEECH_KEY;

    if (!key) {
      console.error('[Speech Transcribe] Azure Speech key not configured');
      res.status(500).json({ error: 'Azure speech env missing' });
      return;
    }

    console.log('[Speech Transcribe] Processing audio file:', req.file.originalname);
    console.log('[Speech Transcribe] Language:', lang, 'Region:', region);

    // Read the uploaded audio file (non-blocking)
    const wav = await fsPromises.readFile(req.file.path);

    // Construct Azure Speech-to-Text API URL
    const url =
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(lang)}&format=simple`;

    console.log('[Speech Transcribe] Calling Azure STT API...');

    // Call Azure Speech-to-Text API
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Accept': 'application/json',
      },
      body: wav,
    });

    // Handle non-OK responses
    if (!response.ok) {
      const statusCode = response.status;
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        errorBody = 'Unable to read error response body';
      }
      
      // Truncate error body for logging (max 200 chars)
      const truncatedBody = errorBody.length > 200 ? errorBody.substring(0, 200) + '...' : errorBody;
      console.error('[Speech Transcribe] Azure STT API error:', {
        status: statusCode,
        body: truncatedBody,
      });
      
      res.status(502).json({
        error: 'STT failed',
        statusCode,
        details: truncatedBody,
      });
      return;
    }

    // Parse response JSON
    let json: { DisplayText?: string; RecognitionStatus?: string };
    try {
      json = await response.json() as { DisplayText?: string; RecognitionStatus?: string };
    } catch (parseError: any) {
      console.error('[Speech Transcribe] Failed to parse Azure response as JSON:', parseError.message);
      res.status(502).json({
        error: 'STT failed',
        statusCode: response.status,
        details: 'Invalid JSON response from Azure',
      });
      return;
    }

    // Check RecognitionStatus and DisplayText
    const recognitionStatus = json.RecognitionStatus;
    const displayText = json.DisplayText || '';

    // If RecognitionStatus indicates no match or DisplayText is empty, check if it's truly no speech
    if (recognitionStatus === 'NoMatch' || (recognitionStatus !== 'Success' && !displayText.trim())) {
      // Only return 400 if it's explicitly a no-match (user didn't speak)
      if (recognitionStatus === 'NoMatch') {
        console.warn('[Speech Transcribe] No speech detected in audio (NoMatch)');
        res.status(400).json({ error: 'No speech detected' });
        return;
      }
      // Otherwise, it's a server error
      console.error('[Speech Transcribe] Azure returned non-success status:', recognitionStatus);
      res.status(502).json({
        error: 'STT failed',
        statusCode: response.status,
        details: `RecognitionStatus: ${recognitionStatus || 'unknown'}`,
      });
      return;
    }

    // Extract text from response
    const text = displayText.trim();

    if (!text) {
      console.warn('[Speech Transcribe] No speech detected in audio (empty DisplayText)');
      res.status(400).json({ error: 'No speech detected' });
      return;
    }

    console.log('[Speech Transcribe] Transcription successful:', text.substring(0, 50) + '...');
    res.json({ text });
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


import { Request, Response } from 'express';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { transcribeAudio as googleTranscribe } from '../services/googleSpeech.service';

const execFileAsync = promisify(execFile);

let ffmpegPath: string;
try {
  const ffmpegStatic = require('ffmpeg-static');
  ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic as any).default || 'ffmpeg';
} catch {
  ffmpegPath = 'ffmpeg';
}

/**
 * Transcribe audio file to text using Google Cloud Speech-to-Text
 * Endpoint: POST /api/ai/speech/transcribe
 * Input: multipart/form-data with field 'audio' (WAV 16kHz mono, or WebM/Opus - converted automatically)
 * Output: { text: string }
 */
export const transcribeAudio = async (req: Request, res: Response): Promise<void> => {
  const tempFilePath = req.file?.path;
  let wavPath: string | null = null;
  
  try {
    console.log('[Speech Transcribe] Request received');
    
    if (!req.user) {
      console.warn('[Speech Transcribe] Unauthorized - no user in request');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      console.warn('[Speech Transcribe] No audio file provided');
      res.status(400).json({ error: 'Missing audio file' });
      return;
    }

    const lang = (req.body && req.body.lang) ? req.body.lang : 'en-US';
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPath) {
      console.error('[Speech Transcribe] GOOGLE_APPLICATION_CREDENTIALS not set');
      res.status(500).json({ error: 'Speech env missing (GOOGLE_APPLICATION_CREDENTIALS)' });
      return;
    }

    console.log('[Speech Transcribe] Processing audio file:', req.file.originalname, 'mimetype:', req.file.mimetype);
    const languageCode = lang === 'en-US' ? 'en-US' : lang;

    const isWebm = (req.file.mimetype || '').includes('webm') || (req.file.originalname || '').toLowerCase().endsWith('.webm');
    let wav: Buffer;

    if (isWebm) {
      // Convert WebM/Opus to raw 16kHz mono LINEAR16 for Google Speech-to-Text
      wavPath = path.join(path.dirname(req.file.path), `transcribe_${Date.now()}.raw`);
      await execFileAsync(ffmpegPath, [
        '-i', req.file.path,
        '-f', 's16le',
        '-ar', '16000',
        '-ac', '1',
        '-y',
        wavPath,
      ]);
      wav = await fsPromises.readFile(wavPath);
    } else {
      wav = await fsPromises.readFile(req.file.path);
      // If upload is WAV, strip 44-byte header so Google gets raw LINEAR16
      if (wav.length > 44 && wav.toString('ascii', 0, 4) === 'RIFF') {
        wav = wav.subarray(44);
      }
    }

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
    if (tempFilePath) {
      try {
        await fsPromises.unlink(tempFilePath);
      } catch (unlinkError: any) {
        console.warn('[Speech Transcribe] Failed to cleanup temp file:', unlinkError.message);
      }
    }
    if (wavPath) {
      try {
        await fsPromises.unlink(wavPath);
      } catch (e: any) {
        console.warn('[Speech Transcribe] Failed to cleanup conversion file:', e?.message);
      }
    }
  }
};


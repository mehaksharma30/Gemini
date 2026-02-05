import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SpeechToTextService {
  private apiUrl = environment.apiUrl;

  constructor(private authService: AuthService) {
    console.log('[STT] Service initialized (Google STT/TTS via backend)');
  }

  /**
   * Microphone access requires a secure context (HTTPS) or localhost.
   */
  private ensureBrowserMicAvailable(): void {
    const isSecure = typeof window !== 'undefined' ? (window as any).isSecureContext === true : false;
    const mediaDevices = typeof navigator !== 'undefined' ? (navigator as any).mediaDevices : undefined;
    const hasGetUserMedia = !!mediaDevices?.getUserMedia;
    if (!hasGetUserMedia) {
      const reason = isSecure ? 'Browser microphone API unavailable.' : 'Microphone requires HTTPS (secure context).';
      throw new Error(`${reason} Please use HTTPS (recommended) or type your message instead.`);
    }
  }

  detectLanguageFromLastMessage(_lastMessage?: string): string {
    return 'en-US';
  }

  /**
   * Transcribe by recording in the browser and sending to server (Google Cloud STT).
   */
  async transcribeViaServer(recordMs: number = 5000): Promise<{ text: string; detectedLang: 'en' }> {
    this.ensureBrowserMicAvailable();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];

    return new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', blob, 'recording.webm');
        formData.append('lang', 'en-US');

        const token = this.authService.getToken();
        if (!token) {
          reject(new Error('Not authenticated. Please log in first.'));
          return;
        }

        try {
          const res = await fetch(`${this.apiUrl}/ai/speech/transcribe`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            reject(new Error(err.error || err.details || `Transcription failed: ${res.status}`));
            return;
          }
          const data = await res.json();
          const text = (data.text || '').trim();
          if (!text) {
            reject(new Error('No speech detected. Please try again.'));
            return;
          }
          resolve({ text, detectedLang: 'en' });
        } catch (e: any) {
          reject(e);
        }
      };
      mediaRecorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        reject(new Error('Recording failed'));
      };
      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, recordMs);
    });
  }

  /**
   * Transcribe speech to text using server-side Google STT only (no Azure/token/region).
   */
  async transcribeOnce(_lastMessage?: string): Promise<{ text: string; detectedLang: 'en' }> {
    console.log('[STT] Starting transcription (server-side, English only)');
    return this.transcribeViaServer(5000);
  }

  /**
   * Speak text using backend POST /api/ai/tts (Google Cloud TTS).
   */
  async speakText(text: string): Promise<void> {
    const authToken = this.authService.getToken();
    if (!authToken) throw new Error('Not authenticated. Please log in first.');

    const response = await fetch(`${this.apiUrl}/ai/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ text, lang: 'en' }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || err.message || `TTS failed: ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to play audio'));
      };
      audio.play().catch(reject);
    });
  }
}

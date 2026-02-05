import { Injectable } from '@angular/core';
import { AIPanicService } from './ai-panic.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface VoiceChatResult {
  userText: string;
  aiText: string;
}

@Injectable({
  providedIn: 'root',
})
export class VoiceChatService {
  private apiUrl = environment.apiUrl;

  constructor(
    private aiPanicService: AIPanicService,
    private authService: AuthService
  ) {
    console.log('[Voice Chat] Service initialized (Google STT/TTS via backend)');
  }

  private ensureBrowserMicAvailable(): void {
    const isSecure = typeof window !== 'undefined' ? (window as any).isSecureContext === true : false;
    const mediaDevices = typeof navigator !== 'undefined' ? (navigator as any).mediaDevices : undefined;
    const hasGetUserMedia = !!mediaDevices?.getUserMedia;
    if (!hasGetUserMedia) {
      const reason = isSecure ? 'Browser microphone API unavailable.' : 'Microphone requires HTTPS (secure context).';
      throw new Error(`${reason} Please use HTTPS (recommended) or type your message instead.`);
    }
  }

  /**
   * Play TTS via backend POST /api/ai/tts (Google Cloud TTS)
   */
  private async playTts(text: string): Promise<void> {
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
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to play audio'));
      };
      audio.play().catch(reject);
    });
  }

  /**
   * Start voice chat: Record → Server STT → AI chat → Server TTS.
   * No Azure token/region; uses Google STT/TTS via backend.
   */
  async startVoice(): Promise<VoiceChatResult | null> {
    try {
      console.log('[Voice Chat] Starting voice chat (server STT/TTS)...');
      this.ensureBrowserMicAvailable();

      const authToken = this.authService.getToken();
      if (!authToken) {
        throw new Error('Not authenticated. Please log in first.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks: Blob[] = [];

      const userText = await new Promise<string | null>((resolve, reject) => {
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('audio', blob, 'recording.webm');
          formData.append('lang', 'en-US');

          try {
            const res = await fetch(`${this.apiUrl}/ai/speech/transcribe`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${authToken}` },
              body: formData,
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              reject(new Error(err.error || err.details || `Transcription failed: ${res.status}`));
              return;
            }
            const data = await res.json();
            const text = (data.text || '').trim();
            resolve(text || null);
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
        }, 5000);
      });

      if (!userText) {
        console.warn('[Voice Chat] No speech detected');
        return null;
      }

      console.log('[Voice Chat] Recognized text:', userText);

      const response = await this.aiPanicService.sendMessageAsync({
        message: userText,
        history: [],
      });

      if (!response?.success || !response?.message) {
        console.error('[Voice Chat] Failed to get AI response');
        return null;
      }

      const aiText = response.message;
      console.log('[Voice Chat] AI response:', aiText);
      console.log('[Voice Chat] Speaking AI response...');
      await this.playTts(aiText);
      console.log('[Voice Chat] Voice chat complete');
      return { userText, aiText };
    } catch (error: any) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission denied. Please allow microphone access.');
      }
      throw error;
    }
  }

  stop(): void {
    console.log('[Voice Chat] Stopped');
  }
}

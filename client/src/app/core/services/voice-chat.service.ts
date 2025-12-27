import { Injectable } from '@angular/core';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { AIPanicService, ChatMessage } from './ai-panic.service';
import { AuthService } from './auth.service';

export interface VoiceChatResult {
  userText: string;
  aiText: string;
}

@Injectable({
  providedIn: 'root',
})
export class VoiceChatService {
  private apiUrl = 'http://localhost:3000/api';

  constructor(
    private aiPanicService: AIPanicService,
    private authService: AuthService
  ) {
    console.log('[Voice Chat] Service initialized');
  }

  /**
   * Get Azure Speech token from backend
   */
  private async getSpeechToken(): Promise<{ token: string; region: string }> {
    try {
      const authToken = this.authService.getToken();
      if (!authToken) {
        throw new Error('Not authenticated');
      }

      console.log('[Voice Chat] Fetching token from:', `${this.apiUrl}/ai/speech/token`);
      const response = await fetch(`${this.apiUrl}/ai/speech/token`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      console.log('[Voice Chat] Token response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        console.error('[Voice Chat] Token error response:', errorData);
        throw new Error(`Failed to get speech token: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[Voice Chat] Token received, region:', data.region);
      return { token: data.token, region: data.region };
    } catch (error: any) {
      console.error('[Voice Chat] Token fetch error:', error);
      throw new Error(`Failed to get speech token: ${error.message}`);
    }
  }

  /**
   * Start voice chat: Listen → Transcribe → Send to AI → Speak response
   * Returns the recognized text and AI response for UI updates
   */
  async startVoice(): Promise<VoiceChatResult | null> {
    try {
      console.log('[Voice Chat] Starting voice chat...');

      // Step 1: Get Azure Speech token
      console.log('[Voice Chat] Fetching Azure Speech token...');
      const { token, region } = await this.getSpeechToken();
      console.log('[Voice Chat] Token received');

      // Step 2: Create speech config with token
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = 'en-US';
      speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';

      // Step 3: Request microphone access
      console.log('[Voice Chat] Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[Voice Chat] Microphone access granted');

      // Step 4: Create audio config and recognizer
      const audioConfig = SpeechSDK.AudioConfig.fromMicrophoneInput();
      const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

      // Step 5: Recognize speech (STT)
      console.log('[Voice Chat] Listening for speech...');
      
      return new Promise<VoiceChatResult | null>((resolve, reject) => {
        recognizer.recognizeOnceAsync(
          async (result) => {
            // Cleanup microphone
            stream.getTracks().forEach(track => track.stop());
            audioConfig.close();
            recognizer.close();

            if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
              const userText = result.text.trim();
              
              if (!userText) {
                console.warn('[Voice Chat] No speech detected');
                resolve(null);
                return;
              }

              console.log('[Voice Chat] Recognized text:', userText);

              // Step 6: Send text to existing chat endpoint
              console.log('[Voice Chat] Sending to AI...');
              try {
                const response = await this.aiPanicService.sendMessageAsync({
                  message: userText,
                  history: [], // Can be enhanced to maintain conversation history
                });

                if (response && response.success && response.message) {
                  const aiText = response.message;
                  console.log('[Voice Chat] AI response:', aiText);

                  // Step 7: Speak AI response (TTS)
                  console.log('[Voice Chat] Speaking AI response...');
                  await this.speakText(aiText, speechConfig);
                  console.log('[Voice Chat] Voice chat complete');

                  // Return result for UI updates
                  resolve({ userText, aiText });
                } else {
                  console.error('[Voice Chat] Failed to get AI response');
                  resolve(null);
                }
              } catch (error: any) {
                console.error('[Voice Chat] AI error:', error);
                resolve(null);
              }
            } else if (result.reason === SpeechSDK.ResultReason.NoMatch) {
              console.warn('[Voice Chat] No speech match detected');
              resolve(null);
            } else {
              console.error('[Voice Chat] Recognition failed:', result.reason);
              resolve(null);
            }
          },
          (error) => {
            // Cleanup on error
            stream.getTracks().forEach(track => track.stop());
            audioConfig.close();
            recognizer.close();
            console.error('[Voice Chat] Recognition error:', error);
            reject(error);
          }
        );
      });
    } catch (error: any) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        console.error('[Voice Chat] Microphone permission denied');
        throw new Error('Microphone permission denied. Please allow microphone access.');
      } else {
        console.error('[Voice Chat] Error:', error);
        throw error;
      }
    }
  }

  /**
   * Speak text using Azure TTS
   */
  private async speakText(text: string, speechConfig: SpeechSDK.SpeechConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, null);

      synthesizer.speakTextAsync(
        text,
        (result) => {
          synthesizer.close();
          if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log('[Voice Chat] TTS completed');
            resolve();
          } else {
            console.error('[Voice Chat] TTS failed:', result.reason);
            reject(new Error(`TTS failed: ${result.reason}`));
          }
        },
        (error) => {
          synthesizer.close();
          console.error('[Voice Chat] TTS error:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Stop voice chat (cleanup if needed)
   */
  stop(): void {
    // Cleanup handled in recognizeOnceAsync callbacks
    console.log('[Voice Chat] Stopped');
  }
}

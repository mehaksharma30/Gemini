import { Injectable } from '@angular/core';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class SpeechToTextService {
  private apiUrl = 'http://localhost:3000/api';

  constructor(
    private authService: AuthService
  ) {
    console.log('[STT] Service initialized');
  }

  /**
   * Get Azure Speech token from backend
   */
  private async getSpeechToken(): Promise<{ token: string; region: string }> {
    try {
      const authToken = this.authService.getToken();
      if (!authToken) {
        throw new Error('Not authenticated. Please log in first.');
      }

      const url = `${this.apiUrl}/ai/speech/token`;
      console.log('[STT] Fetching token from:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      }).catch((fetchError) => {
        console.error('[STT] Fetch error:', fetchError);
        throw new Error(`Network error: ${fetchError.message}`);
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Failed to get speech token: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[STT] Token received, region:', data.region);
      return { token: data.token, region: data.region };
    } catch (error: any) {
      console.error('[STT] Token fetch error:', error);
      throw error;
    }
  }

  /**
   * Detect language from last typed message (always English)
   * Returns 'en-US' always
   */
  detectLanguageFromLastMessage(lastMessage?: string): string {
    return 'en-US'; // Always use English
  }

  /**
   * Transcribe speech to text using Azure Speech-to-Text (English only)
   * Returns transcript text and detected language (always 'en')
   * @param lastMessage - Last typed message (optional, not used)
   */
  async transcribeOnce(lastMessage?: string): Promise<{ text: string; detectedLang: 'en' }> {
    try {
      console.log('[STT] Starting transcription (English only)');

      // Step 1: Get Azure Speech token
      const { token, region } = await this.getSpeechToken();
      console.log('[STT] Token received, region:', region);

      // Step 2: Create speech config with token and English language
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = 'en-US';
      console.log('[STT] Using English (en-US) only');

      // Step 3: Request microphone access
      console.log('[STT] Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[STT] Microphone access granted');

      // Step 4: Create audio config and recognizer (English only)
      const audioConfig = SpeechSDK.AudioConfig.fromMicrophoneInput();
      const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

      // Step 5: Recognize speech (single utterance - final result only)
      console.log('[STT] Listening for speech...');
      
      return new Promise<{ text: string; detectedLang: 'en' }>((resolve, reject) => {
        let finalText = '';
        let hasFinalResult = false;

        recognizer.recognizeOnceAsync(
          (result) => {
            // Cleanup microphone
            stream.getTracks().forEach(track => track.stop());
            audioConfig.close();
            recognizer.close();

            if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
              finalText = result.text.trim();
              
              if (!finalText) {
                console.warn('[STT] No speech detected (empty result)');
                reject(new Error('Couldn\'t catch that—try again'));
                return;
              }

              // Check confidence if available
              const confidence = (result as any).json?.DisplayText ? 1.0 : 0.0;
              if (confidence < 0.3 && finalText.length < 3) {
                console.warn('[STT] Low confidence result:', finalText);
                reject(new Error('Couldn\'t catch that—try again'));
                return;
              }

              // Always English
              const detectedLang: 'en' = 'en';

              console.log('[STT] Recognized text (final):', finalText);
              console.log('[STT] Detected language: en (English only)');
              console.log('[STT] Transcript (first 40 chars):', finalText.substring(0, 40));
              hasFinalResult = true;
              resolve({ text: finalText, detectedLang });
            } else if (result.reason === SpeechSDK.ResultReason.NoMatch) {
              console.warn('[STT] No speech match detected');
              reject(new Error('Couldn\'t catch that—try again'));
            } else if (result.reason === SpeechSDK.ResultReason.Canceled) {
              const cancellation = SpeechSDK.CancellationDetails.fromResult(result);
              console.error('[STT] Recognition canceled:', cancellation.reason, cancellation.errorDetails);
              if (cancellation.reason === SpeechSDK.CancellationReason.Error) {
                reject(new Error(`Recognition error: ${cancellation.errorDetails}`));
              } else {
                reject(new Error('Speech recognition was canceled'));
              }
            } else {
              console.error('[STT] Recognition failed:', result.reason);
              reject(new Error('Speech recognition failed. Please try again.'));
            }
          },
          (error) => {
            // Cleanup on error
            stream.getTracks().forEach(track => track.stop());
            audioConfig.close();
            recognizer.close();
            console.error('[STT] Recognition error:', error);
            reject(error);
          }
        );
      });
    } catch (error: any) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        console.error('[STT] Microphone permission denied');
        throw new Error('Microphone permission denied. Please allow microphone access in your browser settings.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        console.error('[STT] No microphone found');
        throw new Error('No microphone found. Please connect a microphone and try again.');
      } else {
        console.error('[STT] Error:', error);
        throw error;
      }
    }
  }

  /**
   * Speak text using Azure Text-to-Speech
   */
  async speakText(text: string): Promise<void> {
    try {
      console.log('[STT] Starting TTS for text:', text.substring(0, 50) + '...');

      // Get Azure Speech token
      const { token, region } = await this.getSpeechToken();
      console.log('[STT] Got token, region:', region);
      
      // Create speech config
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
      console.log('[STT] Speech config created with voice:', speechConfig.speechSynthesisVoiceName);

      // Create audio config - use null to let browser handle audio output
      // This matches the working VoiceChatService implementation
      const audioConfig = null;
      console.log('[STT] Using null audio config (browser default output)');

      return new Promise((resolve, reject) => {
        const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);
        console.log('[STT] Synthesizer created, starting speakTextAsync...');
        console.log('[STT] Text to speak:', text.substring(0, 100));

        // Set up event listeners to track audio playback
        synthesizer.synthesisStarted = (s, e) => {
          console.log('[STT] Synthesis started - audio generation beginning');
        };
        
        synthesizer.synthesizing = (s, e) => {
          console.log('[STT] Synthesizing - generating audio chunk');
        };

        synthesizer.speakTextAsync(
          text,
          (result) => {
            console.log('[STT] TTS result received, reason:', result.reason);
            console.log('[STT] Result reason code:', SpeechSDK.ResultReason[result.reason]);
            console.log('[STT] TTS result details:', {
              reason: result.reason,
              reasonName: SpeechSDK.ResultReason[result.reason],
              audioData: result.audioData ? `Buffer length: ${result.audioData.byteLength}` : 'No audio data',
              errorDetails: (result as any).errorDetails
            });
            
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
              console.log('[STT] ✅ TTS completed successfully - audio should be playing now');
              console.log('[STT] Audio data length:', result.audioData?.byteLength || 'N/A');
              // Don't close immediately - let audio finish playing
              // Close after a delay to ensure audio has started
              setTimeout(() => {
                synthesizer.close();
                console.log('[STT] Synthesizer closed after audio playback');
              }, 500);
              resolve();
            } else {
              synthesizer.close();
              const errorMsg = `TTS failed: ${result.reason} (${SpeechSDK.ResultReason[result.reason]})`;
              console.error('[STT] ❌', errorMsg);
              if ((result as any).errorDetails) {
                console.error('[STT] Error details:', (result as any).errorDetails);
              }
              reject(new Error(errorMsg));
            }
          },
          (error: any) => {
            console.error('[STT] ❌ TTS error callback:', error);
            console.error('[STT] Error type:', typeof error);
            console.error('[STT] Error message:', error?.message || String(error));
            console.error('[STT] TTS error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
            synthesizer.close();
            reject(error);
          }
        );
      });
    } catch (error: any) {
      console.error('[STT] TTS exception:', error);
      console.error('[STT] TTS exception details:', JSON.stringify(error, null, 2));
      throw error;
    }
  }
}


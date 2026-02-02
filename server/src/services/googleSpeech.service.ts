/**
 * Google Cloud Speech-to-Text for transcription.
 * Env: GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON), optional GCP_PROJECT_ID.
 */

import { v1 as speechV1 } from '@google-cloud/speech';

let client: speechV1.SpeechClient | null = null;

function getClient(): speechV1.SpeechClient {
  if (!client) {
    client = new speechV1.SpeechClient();
  }
  return client;
}

/**
 * Transcribe audio buffer to text.
 * Expects 16kHz mono PCM (WAV/raw). Returns plain text.
 */
export async function transcribeAudio(audioBuffer: Buffer, languageCode: string = 'en-US'): Promise<string> {
  const speechClient = getClient();
  const config = {
    encoding: 'LINEAR16' as const,
    sampleRateHertz: 16000,
    languageCode,
  };
  const audio = {
    content: audioBuffer.toString('base64'),
  };
  const [response] = await speechClient.recognize({ config, audio });
  const transcript = response.results
    ?.map((r) => r.alternatives?.[0]?.transcript ?? '')
    .filter(Boolean)
    .join('\n')
    .trim();
  return transcript ?? '';
}

/**
 * Streaming recognition result interface
 */
export interface StreamingSTTResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
}

/**
 * Google Speech Streaming Recognizer wrapper
 * Maintains similar interface to Azure Speech SDK for compatibility
 */
export class GoogleStreamingRecognizer {
  private recognizeStream: any = null;
  private speechClient: speechV1.SpeechClient;
  private languageCode: string;
  private onInterimResult?: (text: string) => void;
  private onFinalResult?: (text: string) => void;
  private onError?: (error: Error) => void;
  private audioBuffer: Buffer[] = [];

  constructor(languageCode: string = 'en-US') {
    this.speechClient = getClient();
    this.languageCode = languageCode;
  }

  /**
   * Set callback for interim (partial) results
   */
  setRecognizing(callback: (text: string) => void): void {
    this.onInterimResult = callback;
  }

  /**
   * Set callback for final results
   */
  setRecognized(callback: (text: string) => void): void {
    this.onFinalResult = callback;
  }

  /**
   * Set error callback
   */
  setCanceled(callback: (error: Error) => void): void {
    this.onError = callback;
  }

  /**
   * Start streaming recognition
   */
  startContinuousRecognitionAsync(
    onStarted?: () => void,
    onError?: (error: string) => void
  ): void {
    try {
      const requestConfig = {
        config: {
          encoding: 'LINEAR16' as const,
          sampleRateHertz: 16000,
          languageCode: this.languageCode,
          enableAutomaticPunctuation: true,
          model: 'latest_long',
        },
        interimResults: true,
      };

      // Create stream with config
      this.recognizeStream = this.speechClient.streamingRecognize(requestConfig);

      // Set up event handlers
      this.recognizeStream.on('error', (error: Error) => {
        console.error('[Google Speech] Streaming error:', error);
        if (this.onError) {
          this.onError(error);
        }
        if (onError) {
          onError(error.message);
        }
      });

      this.recognizeStream.on('data', (data: any) => {
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          const transcript = result.alternatives?.[0]?.transcript || '';
          const isFinal = result.isFinalAlternative || false;

          if (transcript) {
            if (isFinal) {
              console.log('[Google Speech] Final result:', transcript);
              if (this.onFinalResult) {
                this.onFinalResult(transcript);
              }
            } else {
              console.log('[Google Speech] Interim result:', transcript);
              if (this.onInterimResult) {
                this.onInterimResult(transcript);
              }
            }
          }
        }
      });

      // Write any buffered audio
      if (this.audioBuffer.length > 0) {
        for (const chunk of this.audioBuffer) {
          this.recognizeStream.write({ audioContent: chunk });
        }
        this.audioBuffer = [];
      }

      if (onStarted) {
        onStarted();
      }
    } catch (error: any) {
      console.error('[Google Speech] Failed to start recognition:', error);
      if (onError) {
        onError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Write audio chunk to stream
   */
  write(audioChunk: ArrayBuffer | Buffer): void {
    const buffer = Buffer.isBuffer(audioChunk) ? audioChunk : Buffer.from(audioChunk);
    
    if (this.recognizeStream) {
      this.recognizeStream.write({ audioContent: buffer });
    } else {
      // Buffer audio until stream starts
      this.audioBuffer.push(buffer);
    }
  }

  /**
   * Stop continuous recognition
   */
  stopContinuousRecognitionAsync(
    onStopped?: () => void,
    onError?: (error: string) => void
  ): void {
    try {
      if (this.recognizeStream) {
        this.recognizeStream.end();
        this.recognizeStream = null;
      }
      if (onStopped) {
        onStopped();
      }
    } catch (error: any) {
      console.error('[Google Speech] Error stopping recognition:', error);
      if (onError) {
        onError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Close the recognizer
   */
  close(): void {
    if (this.recognizeStream) {
      this.recognizeStream.end();
      this.recognizeStream = null;
    }
    this.audioBuffer = [];
  }
}

/**
 * Create a new streaming recognizer instance
 */
export function createStreamingRecognizer(languageCode: string = 'en-US'): GoogleStreamingRecognizer {
  return new GoogleStreamingRecognizer(languageCode);
}

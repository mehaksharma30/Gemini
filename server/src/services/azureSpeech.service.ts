// Azure Speech SDK - optional import
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
let sdk: typeof SpeechSDK | null = null;
try {
  sdk = SpeechSDK;
} catch (error) {
  console.warn('[Azure Speech] SDK not installed. Voice features will be disabled.');
  console.warn('[Azure Speech] Install with: npm install microsoft-cognitiveservices-speech-sdk');
}

/**
 * Azure Speech Service for real-time STT and TTS
 * Provides low-latency speech-to-text and text-to-speech capabilities
 */

export interface AzureSpeechConfig {
  subscriptionKey: string;
  region: string;
  language?: string;
  voiceName?: string;
}

let speechConfig: SpeechSDK.SpeechConfig | null = null;

/**
 * Initialize Azure Speech configuration
 */
export function initializeAzureSpeech(): void {
  if (!sdk) {
    console.warn('[Azure Speech] SDK not available. Voice features will be disabled.');
    return;
  }

  const subscriptionKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastus';
  
  if (!subscriptionKey) {
    console.warn('[Azure Speech] Subscription key not found. Voice features will be disabled.');
    return;
  }

  try {
    if (!sdk) {
      console.warn('[Azure Speech] SDK not available. Voice features will be disabled.');
      return;
    }
    speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region);
    speechConfig.speechRecognitionLanguage = process.env.AZURE_SPEECH_LANGUAGE || 'en-US';
    speechConfig.speechSynthesisVoiceName = process.env.AZURE_SPEECH_VOICE || 'en-US-JennyNeural';
    
    console.log('[Azure Speech] Initialized successfully');
    console.log(`[Azure Speech] Region: ${region}`);
    console.log(`[Azure Speech] Language: ${speechConfig.speechRecognitionLanguage}`);
    console.log(`[Azure Speech] Voice: ${speechConfig.speechSynthesisVoiceName}`);
  } catch (error: any) {
    console.error('[Azure Speech] Initialization error:', error.message);
    speechConfig = null;
  }
}

/**
 * Check if Azure Speech is available
 */
export function isAzureSpeechAvailable(): boolean {
  return speechConfig !== null;
}

/**
 * Get Azure Speech configuration
 */
export function getSpeechConfig(): SpeechSDK.SpeechConfig | null {
  return speechConfig;
}

/**
 * Create a push audio input stream for real-time STT
 */
export function createPushAudioInputStream(): SpeechSDK.PushAudioInputStream {
  if (!sdk) throw new Error('Azure Speech SDK not installed');
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  return sdk.AudioInputStream.createPushStream(format);
}

/**
 * Create a pull audio output stream for real-time TTS
 */
export function createPullAudioOutputStream(): SpeechSDK.PullAudioOutputStream {
  if (!sdk) throw new Error('Azure Speech SDK not installed');
  return sdk.AudioOutputStream.createPullStream();
}

/**
 * Convert text to speech (TTS) and return audio data
 * Returns audio data as ArrayBuffer
 */
export async function textToSpeech(text: string): Promise<ArrayBuffer> {
  if (!sdk || !speechConfig) {
    throw new Error('Azure Speech not initialized');
  }

  return new Promise((resolve, reject) => {
    if (!sdk || !speechConfig) {
      reject(new Error('Azure Speech not initialized'));
      return;
    }
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    
    synthesizer.speakTextAsync(
      text,
      (result: SpeechSDK.SpeechSynthesisResult) => {
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
          const audioData = result.audioData;
          synthesizer.close();
          resolve(audioData);
        } else {
          synthesizer.close();
          reject(new Error(`TTS failed: ${result.reason}`));
        }
      },
      (error: Error) => {
        synthesizer.close();
        reject(error);
      }
    );
  });
}

/**
 * Convert text to speech with streaming (for real-time)
 * Returns a readable stream of audio chunks
 */
export function textToSpeechStream(text: string): NodeJS.ReadableStream {
  if (!sdk || !speechConfig) {
    throw new Error('Azure Speech not initialized');
  }

  const { Readable } = require('stream');
  const audioStream = new Readable({
    read() {}
  });

  if (!sdk || !speechConfig) {
    throw new Error('Azure Speech not initialized');
  }
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
  
    synthesizer.speakTextAsync(
      text,
      (result: SpeechSDK.SpeechSynthesisResult) => {
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
          const audioData = result.audioData;
          audioStream.push(Buffer.from(audioData));
          audioStream.push(null); // End stream
          synthesizer.close();
        } else {
          audioStream.destroy(new Error(`TTS failed: ${result.reason}`));
          synthesizer.close();
        }
      },
      (error: Error) => {
        audioStream.destroy(error);
        synthesizer.close();
      }
    );

  return audioStream;
}

/**
 * Speech-to-text recognition result
 */
export interface STTResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
}

/**
 * Convert audio buffer to text (STT)
 * For real-time, use continuous recognition instead
 */
export async function speechToText(audioBuffer: ArrayBuffer): Promise<string> {
  if (!sdk || !speechConfig) {
    throw new Error('Azure Speech not initialized');
  }

  return new Promise((resolve, reject) => {
    if (!sdk || !speechConfig) {
      reject(new Error('Azure Speech not initialized'));
      return;
    }
    const audioConfig = sdk.AudioConfig.fromStreamInput(
      sdk.AudioInputStream.createPushStream(
        sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
      )
    );
    
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    
    // Push audio data
    const pushStream = audioConfig as any;
    if (pushStream && pushStream.write) {
      pushStream.write(Buffer.from(audioBuffer));
      pushStream.close();
    }

    recognizer.recognizeOnceAsync(
      (result: SpeechSDK.SpeechRecognitionResult) => {
        recognizer.close();
        if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          resolve(result.text);
        } else {
          reject(new Error(`STT failed: ${result.reason}`));
        }
      },
      (error: Error) => {
        recognizer.close();
        reject(error);
      }
    );
  });
}


// Azure Speech SDK - optional import
let sdk: typeof import('microsoft-cognitiveservices-speech-sdk') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sdk = require('microsoft-cognitiveservices-speech-sdk');
} catch (error) {
  console.warn('[Azure TTS] SDK not installed. TTS features will be disabled.');
  console.warn('[Azure TTS] Install with: npm install microsoft-cognitiveservices-speech-sdk');
}

/**
 * Curated list of calming, non-robotic English voices for TTS
 * These voices are selected for their warm, soothing, and natural-sounding qualities
 */
const CALMING_VOICES = [
  'en-US-JennyNeural',      // Warm, friendly, natural (default)
  'en-US-AriaNeural',       // Calm, clear, professional
  'en-US-MichelleNeural',   // Gentle, empathetic, soothing
  'en-US-AshleyNeural',     // Soft, caring, warm
  'en-US-AmberNeural',      // Warm, friendly, approachable
];

/**
 * Select a calming voice for TTS synthesis
 * Priority: 1) AZURE_TTS_VOICE_NAME env var, 2) Default calming voice, 3) Fallback to JennyNeural
 */
function selectCalmingVoice(): string {
  // Check for explicit override
  const envVoice = process.env.AZURE_TTS_VOICE_NAME;
  if (envVoice && envVoice.trim()) {
    const voice = envVoice.trim();
    console.log(`[Azure TTS] Using voice from AZURE_TTS_VOICE_NAME: ${voice}`);
    return voice;
  }
  
  // Use default calming voice (first in list)
  const defaultVoice = CALMING_VOICES[0];
  console.log(`[Azure TTS] Using default calming voice: ${defaultVoice}`);
  return defaultVoice;
}

/**
 * Escape text for safe SSML usage (prevents SSML injection/breakage)
 */
function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build SSML with gentle prosody for more natural, calming speech
 */
function buildCalmingSsml(text: string, voiceName: string): string {
  const escapedText = escapeSsml(text);
  // Gentle prosody: slightly slower rate (0.9 = 10% slower), slightly softer pitch (-5%)
  // This makes speech sound more calming and less robotic without being too slow
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
    <voice name="${voiceName}">
      <prosody rate="0.9" pitch="-5%">
        ${escapedText}
      </prosody>
    </voice>
  </speak>`;
}

/**
 * Check if text might benefit from SSML (contains markup-like content or needs prosody)
 */
function shouldUseSsml(text: string): boolean {
  // Use SSML if text contains potential markup or special characters that need escaping
  // Also use SSML for better prosody control (calming effect)
  return true; // Always use SSML for consistent calming prosody
}

/**
 * Synthesize text to MP3 audio using Azure Speech TTS
 * @param text - Text to synthesize (max 2000 chars)
 * @param lang - Language code (e.g., 'en') - defaults to 'en' (English only)
 * @returns Promise<Buffer> - MP3 audio data as Buffer
 */
export async function synthesizeToMp3(text: string, lang?: string): Promise<Buffer> {
  if (!sdk) {
    throw new Error('Azure Speech SDK not installed');
  }

  const subscriptionKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (!subscriptionKey) {
    throw new Error('AZURE_SPEECH_KEY not found in environment variables');
  }

  // Validate text length
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  if (text.length > 2000) {
    throw new Error('Text exceeds maximum length of 2000 characters');
  }

  // Select calming voice (env override or default)
  const voiceName = selectCalmingVoice();

  console.log(`[Azure TTS] Starting synthesis - Text length: ${text.length}, Voice: ${voiceName}, Lang: ${lang || 'en'}`);

  // Create speech config
  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region);
  speechConfig.speechSynthesisVoiceName = voiceName;
  
  // Set output format to MP3 (16kHz, 32kbps, mono)
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

  return new Promise((resolve, reject) => {
    // Create synthesizer with null audio config (returns audio data directly)
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    
    // Ensure synthesizer is always closed (success, cancel, or error)
    let synthesizerClosed = false;
    const closeSynthesizer = () => {
      if (!synthesizerClosed) {
        synthesizerClosed = true;
        try {
          synthesizer.close();
        } catch (closeError: any) {
          console.warn('[Azure TTS] Error closing synthesizer:', closeError.message);
        }
      }
    };

    // Determine if we should use SSML for more natural, calming speech
    const useSsml = shouldUseSsml(text);
    const synthesisInput = useSsml ? buildCalmingSsml(text, voiceName) : text;

    // Success handler
    const onSynthesisComplete = (result: any) => {
      try {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          const audioData = result.audioData;
          if (!audioData || audioData.byteLength === 0) {
            console.error('[Azure TTS] No audio data received from Azure');
            reject(new Error('No audio data received from Azure TTS - audioData is empty or undefined'));
            return;
          }

          // Convert ArrayBuffer to Buffer
          const buffer = Buffer.from(audioData);
          console.log(`[Azure TTS] Synthesis completed - Audio size: ${buffer.length} bytes, Voice: ${voiceName}`);
          resolve(buffer);
        } else if (result.reason === sdk.ResultReason.Canceled) {
          const cancellation = sdk.CancellationDetails.fromResult(result);
          const reason = cancellation.reason || 'unknown';
          const errorDetails = cancellation.errorDetails || 'no details';
          console.error('[Azure TTS] Synthesis canceled:', { reason, errorDetails });
          reject(new Error(`TTS canceled: reason=${reason}, details=${errorDetails}`));
        } else {
          console.error('[Azure TTS] Synthesis failed:', result.reason);
          reject(new Error(`TTS failed: reason=${result.reason || 'unknown'}`));
        }
      } finally {
        closeSynthesizer();
      }
    };

    // Error handler
    const onSynthesisError = (error: string) => {
      try {
        console.error('[Azure TTS] Synthesis error:', error);
        reject(new Error(`TTS synthesis error: ${error}`));
      } finally {
        closeSynthesizer();
      }
    };

    // Use SSML for more natural, calming speech, or plain text
    if (useSsml) {
      synthesizer.speakSsmlAsync(synthesisInput, onSynthesisComplete, onSynthesisError);
    } else {
      synthesizer.speakTextAsync(synthesisInput, onSynthesisComplete, onSynthesisError);
    }
  });
}


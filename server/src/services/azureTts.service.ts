// Azure Speech SDK - optional import
let sdk: any = null;
try {
  sdk = require('microsoft-cognitiveservices-speech-sdk');
} catch (error) {
  console.warn('[Azure TTS] SDK not installed. TTS features will be disabled.');
}

/**
 * Synthesize text to MP3 audio using Azure Speech TTS
 * @param text - Text to synthesize (max 2000 chars)
 * @param lang - Language code (e.g., 'en', 'hi', 'hi') - defaults to 'en'
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

  // Determine voice based on language
  let voiceName = 'en-US-JennyNeural'; // Default English voice
  if (lang && lang.toLowerCase().startsWith('hi')) {
    voiceName = 'hi-IN-SwaraNeural'; // Hindi voice
  } else if (lang && lang.toLowerCase().startsWith('en')) {
    voiceName = 'en-US-JennyNeural'; // English voice
  }

  console.log(`[Azure TTS] Starting synthesis - Text length: ${text.length}, Voice: ${voiceName}, Lang: ${lang || 'en'}`);

  // Create speech config
  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region);
  speechConfig.speechSynthesisVoiceName = voiceName;
  
  // Set output format to MP3
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

  return new Promise((resolve, reject) => {
    // Create synthesizer with null audio config (returns audio data directly)
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          const audioData = result.audioData;
          if (!audioData || audioData.byteLength === 0) {
            console.error('[Azure TTS] No audio data received');
            reject(new Error('No audio data received from Azure TTS'));
            return;
          }

          // Convert ArrayBuffer to Buffer
          const buffer = Buffer.from(audioData);
          console.log(`[Azure TTS] Synthesis completed - Audio size: ${buffer.length} bytes`);
          resolve(buffer);
        } else if (result.reason === sdk.ResultReason.Canceled) {
          const cancellation = sdk.CancellationDetails.fromResult(result);
          console.error('[Azure TTS] Synthesis canceled:', cancellation.reason, cancellation.errorDetails);
          reject(new Error(`TTS canceled: ${cancellation.reason} - ${cancellation.errorDetails}`));
        } else {
          console.error('[Azure TTS] Synthesis failed:', result.reason);
          reject(new Error(`TTS failed: ${result.reason}`));
        }
      },
      (error) => {
        synthesizer.close();
        console.error('[Azure TTS] Synthesis error:', error);
        reject(error);
      }
    );
  });
}


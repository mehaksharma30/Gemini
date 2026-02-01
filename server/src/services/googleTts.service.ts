/**
 * Google Cloud Text-to-Speech for synthesis.
 * Env: GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON).
 */

import { v1 as textToSpeechV1 } from '@google-cloud/text-to-speech';

let client: textToSpeechV1.TextToSpeechClient | null = null;

function getClient(): textToSpeechV1.TextToSpeechClient {
  if (!client) {
    client = new textToSpeechV1.TextToSpeechClient();
  }
  return client;
}

/**
 * Synthesize text to MP3. Returns audio buffer.
 */
export async function synthesizeToMp3(text: string, _lang?: string): Promise<Buffer> {
  if (!text || !text.trim()) {
    throw new Error('Text cannot be empty');
  }
  const truncated = text.trim().slice(0, 2000);
  const speechClient = getClient();
  const voiceName = process.env.GOOGLE_TTS_VOICE_NAME || 'en-US-Neural2-F';
  const [response] = await speechClient.synthesizeSpeech({
    input: { text: truncated },
    voice: {
      languageCode: 'en-US',
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      sampleRateHertz: 24000,
    },
  });
  const audioContent = response.audioContent;
  if (!audioContent || !(audioContent instanceof Uint8Array)) {
    throw new Error('No audio data received from Google TTS');
  }
  return Buffer.from(audioContent);
}

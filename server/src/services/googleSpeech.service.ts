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

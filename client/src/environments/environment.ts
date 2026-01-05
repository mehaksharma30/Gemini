// Ngrok URL will be automatically updated by startWithNgrok script
// Default to localhost for local development
// WebSocket URL can be overridden via NG_APP_WS_URL environment variable
const getWebSocketUrl = (): string => {
  // Check for environment variable first (for build-time configuration)
  if (typeof process !== 'undefined' && (process as any).env?.['NG_APP_WS_URL']) {
    return (process as any).env['NG_APP_WS_URL'];
  }
  // Fallback to default local development URL
  return 'ws://localhost:3000/voice-gateway';
};

export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  ngrokUrl: '', // Will be set by ngrok script if running
  // Voice Gateway WebSocket URL (local development)
  // Can be overridden via NG_APP_WS_URL environment variable
  voiceGatewayUrl: getWebSocketUrl(),
  // Azure Speech Service credentials
  // Set these in your local .env or environment
  azureSpeechKey: '', // Add your AZURE_SPEECH_KEY here
  azureSpeechRegion: 'eastus', // Add your AZURE_SPEECH_REGION here (e.g., 'eastus')
};


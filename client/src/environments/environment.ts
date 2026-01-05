// Ngrok URL will be automatically updated by startWithNgrok script
// Default to localhost for local development
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  ngrokUrl: '', // Will be set by ngrok script if running
  // Voice Gateway WebSocket URL (local development)
  voiceGatewayUrl: 'ws://localhost:3000/voice-gateway',
  // Azure Speech Service credentials
  // Set these in your local .env or environment
  azureSpeechKey: '', // Add your AZURE_SPEECH_KEY here
  azureSpeechRegion: 'eastus', // Add your AZURE_SPEECH_REGION here (e.g., 'eastus')
};


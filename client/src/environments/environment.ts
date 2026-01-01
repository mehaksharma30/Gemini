// Ngrok URL will be automatically updated by startWithNgrok script
// Default to localhost for local development
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000',
  ngrokUrl: '', // Will be set by ngrok script if running
  // Azure Speech Service credentials
  // Set these in your local .env or environment
  azureSpeechKey: '', // Add your AZURE_SPEECH_KEY here
  azureSpeechRegion: 'eastus', // Add your AZURE_SPEECH_REGION here (e.g., 'eastus')
};


export const environment = {
  production: true,
  apiUrl: '/api', // Use relative URL in production
  // Azure Speech Service credentials
  // Set these via environment variables in production
  azureSpeechKey: '', // Set via build-time environment variable
  azureSpeechRegion: 'eastus', // Set via build-time environment variable
};


export const environment = {
  production: true,
  apiUrl: 'https://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/api',
  // Voice Gateway WebSocket URL (production - use wss:// for secure WebSocket)
  voiceGatewayUrl: 'wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway',
  // Azure Speech Service credentials
  // Set these via environment variables in production
  azureSpeechKey: '', // Set via build-time environment variable
  azureSpeechRegion: 'eastus', // Set via build-time environment variable
};


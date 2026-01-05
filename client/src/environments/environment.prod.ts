// WebSocket URL can be overridden via NG_APP_WS_URL environment variable
const getWebSocketUrl = (): string => {
  // Check for environment variable first (for build-time configuration)
  if (typeof process !== 'undefined' && (process as any).env?.['NG_APP_WS_URL']) {
    return (process as any).env['NG_APP_WS_URL'];
  }
  // Fallback to default production URL
  return 'wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway';
};

export const environment = {
  production: true,
  apiUrl: 'https://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/api',
  // Voice Gateway WebSocket URL (production - use wss:// for secure WebSocket)
  // Can be overridden via NG_APP_WS_URL environment variable
  voiceGatewayUrl: getWebSocketUrl(),
  // Azure Speech Service credentials
  // Set these via environment variables in production
  azureSpeechKey: '', // Set via build-time environment variable
  azureSpeechRegion: 'eastus', // Set via build-time environment variable
};


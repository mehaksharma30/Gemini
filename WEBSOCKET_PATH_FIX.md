# WebSocket Path Fix for Azure Production

## Problem
Client connects to `/vo_<session>?userId=...` but server only handled `/voice-gateway`. Connection fails in production.

## Solution
Added support for both `/voice-gateway` and `/vo_<session>` paths to maintain backward compatibility.

## Code Changes

### File: `server/src/services/voiceGateway.service.ts`

**Changes:**
1. Removed hardcoded `path: '/voice-gateway'` from WebSocketServer config
2. Updated `verifyClient` to accept both `/voice-gateway` and `/vo_*` paths
3. Updated connection handler to extract `callId` from `/vo_<session>` path or query params

**Key Changes:**
```typescript
// Before: Only accepted /voice-gateway
path: '/voice-gateway'

// After: Accepts both paths
// No path restriction in WebSocketServer config
// verifyClient checks for both patterns:
const isVoiceGatewayPath = pathname === '/voice-gateway' || pathname === '/voice-gateway/';
const isVoSessionPath = pathname.startsWith('/vo_');

// Connection handler extracts callId from path or query:
if (pathname.startsWith('/vo_')) {
  const sessionMatch = pathname.match(/^\/vo_(.+)$/);
  if (sessionMatch) {
    callId = sessionMatch[1]; // Use session ID from path as callId
  }
  userId = url.searchParams.get('userId');
} else {
  callId = url.searchParams.get('callId');
  userId = url.searchParams.get('userId');
}
```

### File: `server/src/index.ts`

**Changes:**
1. Enhanced startup logging to show both supported paths
2. Enhanced health check to list supported paths

## Supported WebSocket Paths

### Path 1: `/voice-gateway` (Original)
```
wss://your-backend.azurewebsites.net/voice-gateway?callId=<callId>&userId=<userId>
```

### Path 2: `/vo_<session>` (New - for client compatibility)
```
wss://your-backend.azurewebsites.net/vo_<session>?userId=<userId>
```
Where `<session>` is used as the `callId`.

## Server Configuration

**Already Correct:**
- ✅ Uses `http.createServer(app)` 
- ✅ Attaches WebSocket to `httpServer`
- ✅ Listens on `process.env.PORT` (not hardcoded)
- ✅ Listens on `0.0.0.0` (required for Azure)
- ✅ CORS configured with `FRONTEND_ORIGINS`
- ✅ Socket.IO configured with explicit transports

## Environment Variables

**Azure App Service Configuration:**
```bash
FRONTEND_ORIGINS=https://your-frontend.azurestaticapps.net
NODE_ENV=production
PORT=8080  # Azure sets this automatically
```

**Note:** `WEBSOCKETS_ENABLED=true` is not a valid Azure setting. Enable WebSockets in Azure Portal:
- App Service → Configuration → General settings → "Web sockets" = "On"

## Testing

### Health Check
```bash
curl https://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "message": "Voice Gateway WebSocket endpoint is available",
  "websocket": true,
  "supportedPaths": ["/voice-gateway", "/vo_<session>"],
  "port": 8080
}
```

### WebSocket Test - Path 1 (/voice-gateway)
```bash
wscat -c wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway/?callId=test123&userId=user456
```

### WebSocket Test - Path 2 (/vo_<session>)
```bash
wscat -c wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/vo_test123?userId=user456
```

## Expected Server Logs

**On Connection Attempt:**
```
[Voice Gateway] 🔄 Connection attempt from https://...
[Voice Gateway] Path: /vo_test123, Full URL: /vo_test123?userId=user456
[Voice Gateway] ✅ Accepting connection to /vo_test123 from https://...
[Voice Gateway] ✅ WebSocket connection established at 2026-01-05T...
[Voice Gateway] Parsed params - callId: test123, userId: user456
[Voice Gateway] ✅ New connection: userId=user456, callId=test123
```

## Production WebSocket URL

**For client using `/vo_<session>` path:**
```
wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/vo_<session>?userId=<userId>
```

**For client using `/voice-gateway` path:**
```
wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway?callId=<callId>&userId=<userId>
```

## Files Modified

- `server/src/services/voiceGateway.service.ts` - Added `/vo_*` path support
- `server/src/index.ts` - Enhanced logging and health check

## Next Steps

1. ✅ Deploy backend with path fix
2. ✅ Enable WebSocket in Azure Portal (Configuration → General settings)
3. ✅ Set `FRONTEND_ORIGINS` environment variable
4. ✅ Test with wscat using `/vo_<session>` path
5. ✅ Verify client connects successfully


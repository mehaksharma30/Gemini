# Azure WebSocket Production Fix

## Problem
WebSocket connections work locally but fail in production on Azure App Service. Browser console shows connection failures after ~400-500ms.

## Root Cause Analysis

**Server WebSocket Path**: `/voice-gateway` (native `ws` library)
**Client WebSocket Path**: Should be `/voice-gateway` (from `environment.voiceGatewayUrl`)

**Potential Issues:**
1. WebSocket not enabled in Azure App Service
2. Path mismatch between client and server
3. Origin verification blocking connections
4. Missing reverse proxy headers handling
5. Insufficient logging to diagnose issues

## Code Changes

### 1. Enhanced Production Logging

**File**: `server/src/services/voiceGateway.service.ts`

**Changes:**
- Added detailed connection attempt logging (origin, path, headers, X-Forwarded-*)
- Added connection established logging with timestamps
- Added close event logging with duration and packet counts
- Added error stack traces

**File**: `server/src/index.ts`

**Changes:**
- Added middleware to log all WebSocket upgrade attempts
- Added startup logging with server details
- Explicit Socket.IO configuration with transports

### 2. Azure-Specific Configuration

**Socket.IO Configuration:**
```typescript
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, ... },
  transports: ['websocket', 'polling'], // Explicit transports
  path: '/socket.io', // Explicit path
});
```

**HTTP Server:**
- Already using `process.env.PORT` ✓
- Already listening on `0.0.0.0` ✓
- Already attached to `httpServer` ✓

## Environment Variables

### Azure App Service Configuration

**Required:**
```bash
FRONTEND_ORIGINS=https://your-frontend.azurestaticapps.net
NODE_ENV=production
PORT=8080  # Azure sets this automatically, but can be explicit
```

**Optional:**
```bash
FRONTEND_URL=https://your-frontend.azurestaticapps.net  # Legacy support
```

### Frontend Build

**Production build with WebSocket URL:**
```bash
NG_APP_WS_URL=wss://your-backend.azurewebsites.net/voice-gateway npm run build
```

## Azure Portal Checklist

### ✅ 1. Enable WebSocket (CRITICAL)

1. Go to Azure Portal → App Service → `mindmemos-api-2026`
2. Settings → Configuration → General settings
3. Set **"Web sockets"** to **"On"**
4. Click **"Save"** (restarts app)

### ✅ 2. Set Environment Variables

1. Settings → Configuration → Application settings
2. Add:
   - `FRONTEND_ORIGINS` = `https://purple-moss-01574bd1e.4.azurestaticapps.net`
   - `NODE_ENV` = `production`
3. Click **"Save"**

### ✅ 3. Enable Always On (Recommended)

1. Settings → Configuration → General settings
2. Set **"Always On"** to **"On"**
3. Click **"Save"**

## Testing

### 1. Health Check (HTTP)
```bash
curl https://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "message": "Voice Gateway WebSocket endpoint is available",
  "websocket": true,
  "path": "/voice-gateway"
}
```

### 2. WebSocket Connection Test (wscat)

```bash
npm install -g wscat
wscat -c wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway/?callId=test&userId=test
```

**Expected:**
- Connection established
- Server logs show connection attempt
- No errors

### 3. Browser Console Test

1. Open browser console
2. Navigate to your frontend
3. Initiate a voice call
4. Check console logs:
   ```
   [Voice Gateway] 🔌 Connecting to: wss://...
   [Voice Gateway] ✅ Connected successfully
   ```

## Expected Server Logs (Azure Log Stream)

### On Connection Attempt:
```
[HTTP] GET /voice-gateway - Upgrade: websocket, Connection: Upgrade
[Voice Gateway] 🔄 Connection attempt from https://...
[Voice Gateway] Path: /voice-gateway, Full URL: /voice-gateway/?callId=...&userId=...
[Voice Gateway] ✅ Accepting connection to /voice-gateway from https://...
[Voice Gateway] ✅ WebSocket connection established at 2026-01-05T...
[Voice Gateway] ✅ New connection: userId=..., callId=...
```

### On Connection Close:
```
[Voice Gateway] 🔌 User ... disconnected from call ...
[Voice Gateway] Close code: 1000, reason: none, duration: 12345ms
[Voice Gateway] Packets relayed: 1234
```

## Troubleshooting

### Connection Still Failing?

1. **Check WebSocket Enabled:**
   ```bash
   curl -I https://your-backend.azurewebsites.net/voice-gateway/health
   ```
   Should return `200 OK`

2. **Check Azure Log Stream:**
   - Go to App Service → Log stream
   - Look for `[Voice Gateway] 🔄 Connection attempt`
   - Check for rejection reasons

3. **Check Origin:**
   - Verify `FRONTEND_ORIGINS` includes your frontend URL
   - Check logs for "Rejected connection from unauthorized origin"

4. **Check Path:**
   - Client should connect to `/voice-gateway` (not `/vo_*` or other paths)
   - Server logs will show the actual path attempted

5. **Check Network:**
   - Verify no firewall rules blocking WebSocket
   - Check if Always On is enabled

## Files Modified

- `server/src/services/voiceGateway.service.ts` - Enhanced logging
- `server/src/index.ts` - Request logging middleware, Socket.IO config

## Next Steps

1. ✅ Deploy backend with enhanced logging
2. ✅ Enable WebSocket in Azure Portal
3. ✅ Set environment variables
4. ✅ Test with wscat
5. ✅ Monitor Azure Log Stream for connection attempts
6. ✅ Verify frontend connects successfully




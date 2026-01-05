# Production WebSocket Fix - Complete Implementation

## Root Cause Analysis

**WebSocket Library**: Native `ws` library (not Socket.IO)
**Path**: `/voice-gateway`
**Issue**: Connection failures in production due to:
1. WebSocket not enabled in Azure App Service
2. Missing origin verification
3. No reconnection logic
4. Hardcoded URLs instead of environment variables
5. Insufficient error logging

## Code Changes Summary

### 1. Frontend: Dynamic WebSocket URL with Environment Variables

**Files Changed:**
- `client/src/environments/environment.ts`
- `client/src/environments/environment.prod.ts`
- `client/src/app/core/services/voice-gateway.service.ts`

**Changes:**
- Added `getWebSocketUrl()` function that checks `NG_APP_WS_URL` environment variable
- Falls back to default URLs if env var not set
- Added reconnection logic with exponential backoff (1s → 2s → 4s → 8s → 16s → max 30s)
- Enhanced error logging with connection timing and state details
- Added connection lifecycle logging

### 2. Backend: Origin Verification and Enhanced Logging

**Files Changed:**
- `server/src/services/voiceGateway.service.ts`
- `server/src/index.ts`

**Changes:**
- Added origin verification using `FRONTEND_ORIGINS` environment variable
- Enhanced connection attempt logging (origin, path, headers)
- Production vs development origin checking
- Startup logging for allowed origins

## Environment Variables

### Frontend (Build-time)

**Angular Environment Variables:**
```bash
# For production build
NG_APP_WS_URL=wss://your-backend.azurewebsites.net/voice-gateway
```

**Usage in build:**
```bash
NG_APP_WS_URL=wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway npm run build
```

### Backend (Runtime)

**Azure App Service Configuration:**
```bash
FRONTEND_ORIGINS=https://your-frontend.azurestaticapps.net,https://another-origin.com
FRONTEND_URL=https://your-frontend.azurestaticapps.net  # Legacy support
NODE_ENV=production
```

**Azure Portal Setup:**
1. Go to App Service → Configuration → Application settings
2. Add `FRONTEND_ORIGINS` with comma-separated origins
3. Add `NODE_ENV=production`
4. Save and restart

## Azure Checklist

### ✅ Required Azure App Service Settings

1. **Enable WebSocket** (CRITICAL):
   - Portal: App Service → Configuration → General settings
   - Set "Web sockets" to **"On"**
   - Click "Save" (restarts app)

2. **Port Binding**:
   - Azure App Service automatically handles port binding
   - Use `process.env.PORT` (already implemented)
   - Server listens on `0.0.0.0` (already implemented)

3. **Always On** (Recommended):
   - Portal: App Service → Configuration → General settings
   - Set "Always On" to **"On"**
   - Prevents app from sleeping

4. **CORS Origins**:
   - Portal: App Service → Configuration → Application settings
   - Add `FRONTEND_ORIGINS` with your frontend URL(s)
   - Example: `https://purple-moss-01574bd1e.4.azurestaticapps.net`

5. **Environment**:
   - Add `NODE_ENV=production` for production origin checking

## Testing

### Local Testing
```bash
# Terminal 1: Start backend
cd server
npm run dev

# Terminal 2: Start frontend
cd client
npm start

# Test WebSocket connection
# Open browser console and initiate a call
# Should see: "[Voice Gateway] ✅ Connected successfully"
```

### Production Testing
1. Deploy backend with WebSocket enabled
2. Deploy frontend with `NG_APP_WS_URL` set
3. Open browser console
4. Initiate call
5. Check logs:
   - Frontend: Connection lifecycle logs
   - Backend: Azure Log Stream for connection attempts

## Expected Logs

### Frontend (Browser Console)
```
[Voice Gateway] 🔌 Connecting to: wss://...
[Voice Gateway] Attempt 1/10
[Voice Gateway] ✅ Connected successfully (234ms)
[Voice Gateway] WebSocket readyState: 1, URL: wss://...
```

### Backend (Azure Log Stream)
```
[Voice Gateway] 🔄 Connection attempt from https://...
[Voice Gateway] Path: /voice-gateway, Full URL: /voice-gateway/?callId=...
[Voice Gateway] ✅ Accepting connection to /voice-gateway from https://...
```

## Reconnection Behavior

- **Max Attempts**: 10
- **Backoff**: Exponential (1s, 2s, 4s, 8s, 16s, max 30s)
- **Triggers**: 
  - Connection errors
  - Unexpected disconnects (non-clean close)
- **Stops On**:
  - Clean close (code 1000)
  - Max attempts reached
  - Manual disconnect

## Troubleshooting

### Connection Still Failing?

1. **Check WebSocket Enabled**:
   ```bash
   curl -I https://your-backend.azurewebsites.net/voice-gateway/health
   # Should return 200 OK
   ```

2. **Check Origin**:
   - Verify `FRONTEND_ORIGINS` includes your frontend URL
   - Check browser console for origin rejection logs

3. **Check Azure Log Stream**:
   - Look for connection attempt logs
   - Verify path is `/voice-gateway` (not `/voice-gateway/`)

4. **Test with wscat**:
   ```bash
   npm install -g wscat
   wscat -c wss://your-backend.azurewebsites.net/voice-gateway/?callId=test&userId=test
   ```

## Files Modified

### Frontend
- `client/src/environments/environment.ts` - Added env var support
- `client/src/environments/environment.prod.ts` - Added env var support
- `client/src/app/core/services/voice-gateway.service.ts` - Reconnection + logging

### Backend
- `server/src/services/voiceGateway.service.ts` - Origin verification + logging
- `server/src/index.ts` - Startup logging

## Next Steps

1. ✅ Enable WebSocket in Azure Portal
2. ✅ Set `FRONTEND_ORIGINS` in Azure App Service
3. ✅ Set `NG_APP_WS_URL` in frontend build (if different from default)
4. ✅ Deploy and test
5. ✅ Monitor Azure Log Stream for connection attempts


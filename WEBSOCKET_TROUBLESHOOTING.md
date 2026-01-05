# WebSocket Connection Troubleshooting

## Current Issue
WebSocket connection to Azure App Service is failing with error code 1006.

## Required Steps

### 1. Enable WebSocket in Azure Portal (CRITICAL)

**This is the most likely cause of the connection failure.**

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **App Services** → **mindmemos-api-2026**
3. Go to: **Settings** → **Configuration**
4. Under **General settings**, find **"Web sockets"**
5. Set it to **"On"**
6. Click **"Save"** (this will restart the app)

**OR use Azure CLI:**
```bash
az webapp config set \
  --name mindmemos-api-2026 \
  --resource-group mindmemos-api-2026-group \
  --web-sockets-enabled true
```

### 2. Check Server Logs

After enabling WebSocket, check the Azure App Service logs:

1. Go to: **App Service** → **Log stream**
2. Look for: `[Voice Gateway] WebSocket server initialized on /voice-gateway`
3. When a connection is attempted, you should see: `[Voice Gateway] 🔄 Connection attempt from...`

### 3. Test the Connection

**Health Check (HTTP):**
```bash
curl https://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway/health
```

**WebSocket Test (using wscat):**
```bash
npm install -g wscat
wscat -c wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway/?callId=test&userId=test
```

### 4. Common Issues

**Issue: WebSocket not enabled**
- **Symptom**: Connection fails immediately with error 1006
- **Solution**: Enable WebSocket in Azure Portal (Step 1)

**Issue: Path mismatch**
- **Symptom**: Connection rejected, server logs show "Rejected connection to invalid path"
- **Solution**: Ensure URL is exactly `/voice-gateway` (with or without trailing slash)

**Issue: CORS blocking**
- **Symptom**: Connection fails, CORS errors in browser console
- **Solution**: Add frontend origin to `FRONTEND_ORIGINS` environment variable

**Issue: Server not running**
- **Symptom**: No server logs, health endpoint returns 404
- **Solution**: Check deployment status, restart the app service

### 5. Verify Deployment

Check that the latest code is deployed:
1. Go to: **App Service** → **Deployment Center**
2. Verify latest deployment is successful
3. Check **Log stream** for server startup messages

### 6. Network/Firewall Issues

If WebSocket is enabled but still failing:
- Check Azure App Service **Networking** settings
- Verify no firewall rules are blocking WebSocket connections
- Check if **Always On** is enabled (Settings → Configuration → General settings)

## Expected Behavior After Fix

Once WebSocket is enabled:
1. Server logs should show: `[Voice Gateway] WebSocket server initialized`
2. Connection attempts should show: `[Voice Gateway] 🔄 Connection attempt from...`
3. Successful connections should show: `[Voice Gateway] ✅ New connection: userId=..., callId=...`
4. Frontend should connect successfully without errors


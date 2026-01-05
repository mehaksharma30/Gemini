# Azure App Service WebSocket Configuration

## Important: Enable WebSocket in Azure Portal

Azure App Service requires WebSocket to be explicitly enabled. Follow these steps:

### Steps to Enable WebSocket:

1. **Go to Azure Portal**: https://portal.azure.com
2. **Navigate to your App Service**: `mindmemos-api-2026`
3. **Go to Settings → Configuration**
4. **Under "General settings"**, find **"Web sockets"**
5. **Set it to "On"**
6. **Click "Save"** and wait for the app to restart

### Alternative: Enable via Azure CLI

```bash
az webapp config set --name mindmemos-api-2026 --resource-group mindmemos-api-2026-group --web-sockets-enabled true
```

### Verify WebSocket is Enabled

After enabling, test the connection:
- WebSocket URL: `wss://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway`
- Health check: `https://mindmemos-api-2026-gcahetc8hee0hjf9.centralus-01.azurewebsites.net/voice-gateway/health`

### Troubleshooting

If WebSocket connections still fail after enabling:

1. **Check Application Logs**: Go to Azure Portal → App Service → Log stream
2. **Verify Server is Running**: Check that the server logs show "Voice Gateway WebSocket server initialized"
3. **Check CORS**: Ensure the frontend origin is in the allowed origins list
4. **Network Issues**: Verify there are no firewall rules blocking WebSocket connections

### Notes

- WebSocket support is available on all Azure App Service tiers
- For Linux App Service, WebSocket should work once enabled
- The WebSocket server is integrated into the Express HTTP server on path `/voice-gateway`





# Azure Web PubSub Setup for Real-Time 2-Way Audio Communication

## Overview

This implementation enables real-time 2-way audio communication between users using Azure Web PubSub Service. The system supports:
- Real-time audio streaming between two users
- Low-latency communication
- Mute/unmute functionality
- Volume control
- Connection state management

## Architecture

```
User 1 (Browser)                    Azure Web PubSub                    User 2 (Browser)
     │                                      │                                    │
     │─── Connect ─────────────────────────>│                                    │
     │<── Token ────────────────────────────│                                    │
     │                                      │                                    │
     │─── Join Group ──────────────────────>│                                    │
     │                                      │                                    │
     │─── Start Recording ──────────────────>│                                    │
     │                                      │                                    │
     │─── Audio Chunks ─────────────────────>│─── Audio Chunks ──────────────────>│
     │                                      │                                    │
     │<── Audio Chunks ─────────────────────│<── Audio Chunks ───────────────────│
     │                                      │                                    │
     │─── Stop Recording ───────────────────>│                                    │
     │                                      │                                    │
     │─── Disconnect ───────────────────────>│                                    │
```

## Installation

### Backend

1. Install Azure Web PubSub packages:
```bash
cd server
npm install @azure/web-pubsub @azure/web-pubsub-express
```

### Frontend

1. Install Azure Web PubSub client:
```bash
cd client
npm install @azure/web-pubsub-client
```

## Environment Variables

Add these to your `server/.env` file:

```env
# Azure Web PubSub Service
AZURE_WEB_PUBSUB_ENDPOINT=https://mindmemos-rn.webpubsub.azure.com
AZURE_WEB_PUBSUB_ACCESS_KEY=2ZCSI3jMXeD5uKxv7TtBsnplvnDYVrF4ipNCP8FJRky0vXOufvShJQQJ99BLACYeBjFXJ3w3AAAAAWPSpPqn
AZURE_WEB_PUBSUB_HUB_NAME=voice
```

**Note:** The access key shown above is from your Azure portal. Keep it secure and never commit it to version control.

## Backend API Endpoints

### 1. Generate Token
**POST** `/api/webpubsub/token`

Request body:
```json
{
  "targetUserId": "optional_target_user_id"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "url": "wss://mindmemos-rn.webpubsub.azure.com/client/hubs/voice?access_token=...",
    "token": "...",
    "hubName": "voice"
  }
}
```

### 2. Send to Group
**POST** `/api/webpubsub/send`

Request body:
```json
{
  "groupId": "user1-user2",
  "message": {
    "type": "audio",
    "data": "..."
  }
}
```

### 3. Health Check
**GET** `/api/webpubsub/health`

Response:
```json
{
  "success": true,
  "data": {
    "available": true,
    "hubName": "voice"
  }
}
```

## Frontend Usage

### 1. Initialize Audio Communication

```typescript
import { AudioCommunicationService } from './core/services/audio-communication.service';

constructor(private audioComm: AudioCommunicationService) {}

async startCall(targetUserId: string) {
  const currentUserId = this.authService.getCurrentUser()?.id;
  if (!currentUserId) return;

  try {
    await this.audioComm.initialize(currentUserId, targetUserId);
    await this.audioComm.startRecording();
  } catch (error) {
    console.error('Failed to start call:', error);
  }
}
```

### 2. Stop Call

```typescript
async stopCall() {
  await this.audioComm.stopRecording();
  await this.audioComm.cleanup();
}
```

### 3. Toggle Mute

```typescript
async toggleMute() {
  await this.audioComm.toggleMute();
}
```

### 4. Monitor State

```typescript
this.audioComm.state$.subscribe(state => {
  console.log('Recording:', state.isRecording);
  console.log('Playing:', state.isPlaying);
  console.log('Muted:', state.isMuted);
  console.log('Volume:', state.volume);
});
```

## Integration with Messages Component

To add voice calling to the messages component:

1. Import the service:
```typescript
import { AudioCommunicationService } from '../core/services/audio-communication.service';
```

2. Add call button in the chat header:
```html
<button (click)="startVoiceCall()" [disabled]="isInCall">
  📞 Call
</button>
```

3. Implement call methods:
```typescript
isInCall = false;

async startVoiceCall() {
  if (!this.selectedConversation) return;
  
  this.isInCall = true;
  const targetUserId = this.selectedConversation.otherParticipant.id;
  
  try {
    await this.audioComm.initialize(this.currentUserId, targetUserId);
    await this.audioComm.startRecording();
  } catch (error) {
    console.error('Call failed:', error);
    this.isInCall = false;
  }
}

async endCall() {
  await this.audioComm.cleanup();
  this.isInCall = false;
}
```

## Security Considerations

1. **Token Generation**: Tokens are generated server-side with user authentication
2. **Group Access**: Users can only join groups they're authorized for
3. **Access Keys**: Never expose access keys in frontend code
4. **HTTPS/WSS**: Always use secure connections in production

## Troubleshooting

### Connection Issues

1. Check that environment variables are set correctly
2. Verify Azure Web PubSub service is running
3. Check browser console for WebSocket connection errors
4. Ensure CORS is configured correctly

### Audio Issues

1. Check microphone permissions in browser
2. Verify audio codec support (WebM/Opus)
3. Check network latency
4. Monitor Web PubSub service logs

### Token Errors

1. Verify access key is correct
2. Check token expiration (default: 60 minutes)
3. Ensure user is authenticated
4. Check backend logs for token generation errors

## Testing

1. **Health Check**:
```bash
curl http://localhost:3000/api/webpubsub/health
```

2. **Generate Token** (requires authentication):
```bash
curl -X POST http://localhost:3000/api/webpubsub/token \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId": "user2_id"}'
```

## Next Steps

1. Add UI for call controls (mute, volume, hang up)
2. Add call notifications
3. Add call history
4. Implement call quality indicators
5. Add screen sharing (optional)


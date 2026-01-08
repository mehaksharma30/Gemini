# Walkie-Talkie User-to-User Implementation

## ✅ CONFIRMATION: Panic AI Chat Untouched

**All Panic AI Chat functionality remains completely unchanged:**
- `server/src/controllers/aiPanic.controller.ts` - Untouched
- `server/src/routes/panic.routes.ts` - Untouched
- `server/src/services/aiPanic.service.ts` - Untouched
- `client/src/app/panic/panic.component.ts` - Untouched (only added walkie-talkie navigation button)
- All AI/STT/TTS services - Untouched

## Files Modified/Created

### Server Side:
1. ✅ `server/src/models/WalkieTalkieMessage.ts` - Updated schema (removed AI fields, added fromUserId/toUserId)
2. ✅ `server/src/controllers/walkieTalkie.controller.ts` - Complete rewrite (removed all AI/STT/TTS, pure user-to-user)
3. ✅ `server/src/routes/walkieTalkie.routes.ts` - Updated routes to match new API spec

### Client Side:
4. ✅ `client/src/app/core/models/walkie-talkie.model.ts` - Updated models (removed AI fields)
5. ✅ `client/src/app/core/services/walkie-talkie.service.ts` - Updated service (new API endpoints)
6. ✅ `client/src/app/walkie-talkie/walkie-talkie.component.ts` - Complete rewrite (removed AI, added user selection, polling)
7. ✅ `client/src/app/walkie-talkie/walkie-talkie.component.html` - Updated template (user-to-user UI)

## API Endpoints (Implemented)

### POST /api/wt/send
- **Purpose**: Upload audio message from one user to another
- **Body**: `multipart/form-data`
  - `fromUserId` (string, required)
  - `toUserId` (string, required)
  - `threadId` (string, optional)
  - `clientTimestamp` (number, optional)
  - `audio` (file, required - wav/m4a/webm)
- **Response**: `{ threadId, messageId, createdAt, audioUrl }`

### GET /api/wt/thread?userA=<id>&userB=<id>
- **Purpose**: Get all messages in a thread between two users
- **Query Params**: `userA`, `userB` (both required)
- **Response**: `{ threadId, messages: [...] }`

### GET /api/wt/poll?threadId=<id>&after=<timestamp>
- **Purpose**: Get new messages after a timestamp/messageId
- **Query Params**: `threadId` (required), `after` (optional)
- **Response**: `{ messages: [...] }`

### GET /api/wt/audio/:messageId
- **Purpose**: Serve audio file for playback
- **Params**: `messageId` (required)
- **Response**: Audio file stream

## Features Implemented

### Website (User B):
- ✅ Select contact from emergency contacts list
- ✅ Record audio (3-10 seconds) using browser MediaRecorder
- ✅ Send audio message via HTTP POST
- ✅ Poll for new messages every 1.5 seconds
- ✅ Display messages with sender info and timestamps
- ✅ Play audio messages using HTML5 audio
- ✅ Auto-play new messages received from watch user

### Server:
- ✅ Store audio files in `uploads/` directory
- ✅ Generate deterministic thread IDs (sorted user IDs)
- ✅ Store messages with fromUserId/toUserId
- ✅ Serve audio files with proper authentication
- ✅ Support polling with timestamp/messageId filtering

## Testing Instructions

### 1. Server Setup:
```bash
cd server
npm install
npm run build
npm start
```

### 2. Client Setup:
```bash
cd client
npm install
npm start
```

### 3. Test Flow (Website → Website):
1. Login to website as User A
2. Navigate to `/walkie-talkie`
3. Select a contact (User B) from the list
4. Click "Record (3-10s)" and speak
5. Click "Stop & Send"
6. Message should appear in the conversation
7. Open website in another browser/incognito as User B
8. Navigate to `/walkie-talkie` and select User A
9. Message from User A should appear (via polling)
10. Click "Play Audio" to hear the message

### 4. Test Flow (Watch → Website):
1. Watch user records 3-10s audio
2. Watch uploads to `POST /api/wt/send` with:
   - `fromUserId`: watch user ID
   - `toUserId`: website user ID
   - `audio`: audio file
3. Website polls `GET /api/wt/poll` every 1.5s
4. New message appears and auto-plays

## WatchOS Implementation (TODO)

WatchOS implementation needs to be added:
- Create `WalkieTalkieService.swift`:
  - Record audio (3-10s) to WAV or M4A
  - Upload to `POST /api/wt/send`
  - Poll `GET /api/wt/poll` every 2s
  - Play received audio using AVPlayer

- Create `WalkieTalkieView.swift`:
  - UI for selecting contact
  - Record button
  - Message list with play buttons
  - Status indicators

## Notes

- **NO AI**: This feature has zero AI/STT/TTS/OpenAI integration
- **HTTP ONLY**: No WebSockets, no Socket.IO, no realtime streaming
- **Polling**: Website polls every 1.5s, watch should poll every 2s
- **Thread ID**: Deterministic based on sorted user IDs
- **Audio Format**: Supports WAV, M4A, WebM (browser records as WebM)
- **Authentication**: Uses existing auth middleware (JWT tokens)

## Next Steps

1. Implement WatchOS WalkieTalkieService and WalkieTalkieView
2. Test end-to-end: Watch → Server → Website
3. Add error handling for network failures
4. Add message status indicators (sent, delivered, played)
5. Add audio duration display
6. Add message timestamps with date grouping


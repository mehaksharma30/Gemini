# Voice Gateway - Local Setup for MindMemos

## Quick Start

### 1. Start Voice Gateway Server

```bash
cd voice-gateway
npm install  # (if not already done)
npm start
```

Server will run on `ws://localhost:8080`

### 2. Start MindMemos Backend

```bash
cd server
npm run dev
```

Backend will run on `http://localhost:3000`

### 3. Start MindMemos Frontend

```bash
cd client
npm start
```

Frontend will run on `http://localhost:4200`

## Access Voice Gateway

1. Open `http://localhost:4200`
2. Login to your account
3. Navigate to: `http://localhost:4200/voice-gateway`

## Testing Voice Communication

1. Open two browser tabs/windows
2. Both go to `http://localhost:4200/voice-gateway`
3. In both tabs:
   - Use the same **Call ID** (e.g., `test-call-1`)
   - Use different **User IDs** (e.g., `userA` and `userB`)
4. Click **Connect** in both tabs
5. Click **Start Mic** in both tabs
6. Speak into one tab's microphone → you should hear it in the other tab

## What's Integrated

- ✅ Voice Gateway server (`/voice-gateway` folder)
- ✅ Voice Gateway component (`/client/src/app/voice-gateway`)
- ✅ Route: `/voice-gateway` (requires authentication)
- ✅ Connects to `ws://localhost:8080` in local mode

## Troubleshooting

- **Port 8080 in use**: Kill existing process: `lsof -ti:8080 | xargs kill -9`
- **Can't connect**: Make sure voice gateway server is running
- **No audio**: Check browser microphone permissions
- **Distorted audio**: Check browser console for errors





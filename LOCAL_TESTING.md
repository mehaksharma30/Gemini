# Local Testing (Gemini + Google Cloud STT/TTS)

## 1. Environment variables

Create `server/.env` (never commit it). Optionally create `server/.env.example` with placeholder keys (no real secrets) so others know which vars to set. Example vars:

```env
# Required for AI (Gemini)
GEMINI_API_KEY=<your-gemini-api-key>

# Required for STT/TTS (Google Cloud)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account.json
# GCP_PROJECT_ID= optional if set in the JSON

# Existing app vars (examples)
MONGODB_URI=mongodb://localhost:27017/mindmemos
PORT=3000
FRONTEND_URL=http://localhost:4200
JWT_SECRET=your-jwt-secret
```

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).  
For Speech-to-Text and Text-to-Speech, create a GCP project, enable the APIs, and download a service account JSON key. Set `GOOGLE_APPLICATION_CREDENTIALS` to that file path.

## 2. Run backend and frontend

```bash
# Terminal 1 – backend
cd server
npm install
npm run dev

# Terminal 2 – frontend
cd client
npm install
npm start
```

Backend: `http://localhost:3000`. Frontend: `http://localhost:4200`.

## 3. Test endpoints

### Chat (AI Talk)

```bash
# Replace YOUR_JWT with a valid JWT after logging in
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"question":"How can I feel calmer today?"}'
```

Expected: `{ "success": true, "answer": "...", "recommendations": [...] }`.

### Panic chat

```bash
curl -X POST http://localhost:3000/api/ai/panic-chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"message":"I feel anxious","history":[]}'
```

Expected: `{ "success": true, "message": "...", "conversationId": "..." }`.

### STT (transcribe audio)

```bash
curl -X POST http://localhost:3000/api/ai/speech/transcribe \
  -H "Authorization: Bearer YOUR_JWT" \
  -F "audio=@/path/to/audio.wav" \
  -F "lang=en-US"
```

Expected: `{ "text": "transcribed text" }`.  
Audio should be 16 kHz mono PCM (e.g. WAV with that format).

### TTS (synthesize speech)

```bash
curl -X POST http://localhost:3000/api/ai/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"text":"Hello, this is a test.","lang":"en"}' \
  --output out.mp3
```

Play the returned MP3:

```bash
# macOS
afplay out.mp3

# Or open in any media player
open out.mp3
```

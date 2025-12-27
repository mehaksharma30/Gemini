# Real-Time Voice Chat Setup Guide

## Overview
This implementation adds real-time voice conversation capabilities to the MindMemos panic chat feature using Azure Speech Services (STT & TTS) with Socket.IO for low-latency streaming.

## Architecture

### Flow:
1. **User speaks** → Microphone captures audio (16kHz PCM)
2. **Frontend** → Sends audio chunks via Socket.IO to backend
3. **Backend** → Azure Speech STT converts audio to text
4. **Backend** → OpenAI/Ollama generates AI response
5. **Backend** → Azure Speech TTS converts text to audio
6. **Backend** → Sends audio chunks back via Socket.IO
7. **Frontend** → Plays audio through speakers

## Installation

### 1. Install Azure Speech SDK

**Backend:**
```bash
cd server
npm install microsoft-cognitiveservices-speech-sdk
```

**Frontend:**
```bash
cd client
npm install microsoft-cognitiveservices-speech-sdk
```

### 2. Azure Speech Service Setup

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a "Speech Services" resource
3. Get your **Subscription Key** and **Region** (e.g., `eastus`, `westus2`)

### 3. Environment Variables

Add to `server/.env`:
```env
# Azure Speech Services
AZURE_SPEECH_KEY=your_azure_speech_subscription_key_here
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_LANGUAGE=en-US
AZURE_SPEECH_VOICE=en-US-JennyNeural
```

**Available Voices:**
- `en-US-JennyNeural` (Female, friendly)
- `en-US-GuyNeural` (Male, calm)
- `en-US-AriaNeural` (Female, empathetic)
- See [Azure Neural Voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts#neural-voices) for more options

## Features Implemented

### Backend (`server/src/`)
1. **`services/azureSpeech.service.ts`**
   - Azure Speech SDK initialization
   - STT (Speech-to-Text) functions
   - TTS (Text-to-Speech) functions with streaming
   - Audio format conversion utilities

2. **`socket/voiceChatSocket.ts`**
   - Socket.IO handlers for real-time voice chat
   - Continuous speech recognition
   - Audio streaming pipeline
   - Conversation history management
   - User post context integration

3. **`controllers/voice.controller.ts`**
   - Endpoint to provide Azure Speech tokens to frontend
   - Route: `GET /api/ai/voice/token`

### Frontend (`client/src/app/`)
1. **`core/services/voice-chat.service.ts`**
   - Audio capture from microphone
   - Real-time audio streaming via Socket.IO
   - Audio playback
   - Voice chat session management

2. **`panic/panic.component.ts`** (Updated)
   - Voice mode toggle button
   - Real-time status indicators (Listening/Speaking/Ready)
   - Interim text display
   - Voice chat integration

## Usage

1. **Start the servers:**
   ```bash
   # Terminal 1 - Backend
   cd server
   npm run dev

   # Terminal 2 - Frontend
   cd client
   npm start
   ```

2. **Use Voice Chat:**
   - Navigate to `/panic` page
   - Click "Talk to AI" button
   - Click the microphone icon (🎤) in the chat header
   - Grant microphone permissions when prompted
   - Start speaking - the AI will respond with voice!

## Low-Latency Optimizations

1. **Streaming Architecture:**
   - Audio sent in chunks (not full recordings)
   - TTS audio streamed back in real-time
   - No waiting for complete audio before playback

2. **Audio Format:**
   - 16kHz, 16-bit, mono PCM (optimal for speech)
   - Echo cancellation and noise suppression enabled

3. **Socket.IO:**
   - WebSocket transport (lowest latency)
   - Binary audio data sent as Base64 (can be optimized to binary later)

## Troubleshooting

### "Azure Speech not configured"
- Check that `AZURE_SPEECH_KEY` is set in `server/.env`
- Verify the key is valid in Azure Portal

### "Failed to access microphone"
- Check browser permissions
- Ensure HTTPS in production (required for microphone access)
- Try a different browser

### "Voice chat not working"
- Check browser console for errors
- Verify Socket.IO connection (check Network tab)
- Ensure backend is running and Azure Speech is initialized

### High Latency
- Check network connection
- Verify Azure region is close to your location
- Consider using Azure Speech SDK directly on frontend (requires token endpoint)

## Security Notes

⚠️ **Important:** The current implementation sends the Azure Speech key to the frontend. For production:

1. **Implement Token Endpoint:**
   - Create a backend endpoint that generates time-limited tokens
   - Use Azure Speech Token Service
   - Never expose subscription keys to frontend

2. **Example Token Endpoint:**
   ```typescript
   // Generate token using Azure REST API
   const tokenResponse = await fetch(
     `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
     {
       method: 'POST',
       headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey }
     }
   );
   ```

## Future Enhancements

1. **Token-based Authentication** (Security)
2. **Binary WebSocket** (Lower latency than Base64)
3. **Voice Activity Detection** (Auto-start/stop)
4. **Multiple Language Support**
5. **Voice Cloning** (Custom AI voice)
6. **Offline Mode** (Browser-based STT/TTS)

## Files Created/Modified

### Created:
- `server/src/services/azureSpeech.service.ts`
- `server/src/socket/voiceChatSocket.ts`
- `server/src/controllers/voice.controller.ts`
- `client/src/app/core/services/voice-chat.service.ts`

### Modified:
- `server/src/index.ts` (Azure Speech initialization)
- `server/src/routes/ai.routes.ts` (Voice token route)
- `client/src/app/panic/panic.component.ts` (Voice mode UI)

## Testing

1. Test microphone access
2. Test STT accuracy
3. Test TTS quality
4. Test end-to-end latency
5. Test conversation flow
6. Test error handling

## Support

For issues or questions:
- Check Azure Speech Service documentation
- Review Socket.IO connection logs
- Check browser console for frontend errors
- Check server logs for backend errors


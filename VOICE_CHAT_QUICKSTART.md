# Voice Chat Quick Start Guide

## Complete Setup for STT → OpenAI → TTS Pipeline

### Step 1: Install Azure Speech SDK

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

### Step 2: Get Azure Speech Credentials

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a new **Speech Services** resource
3. Copy your **Subscription Key** and **Region** (e.g., `eastus`, `westus2`)

### Step 3: Configure Environment Variables

Add to `server/.env`:
```env
# Azure Speech Services (REQUIRED for voice chat)
AZURE_SPEECH_KEY=your_azure_speech_subscription_key_here
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_LANGUAGE=en-US
AZURE_SPEECH_VOICE=en-US-JennyNeural

# OpenAI (already configured)
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5-mini
```

### Step 4: Restart Servers

```bash
# Terminal 1 - Backend
cd server
npm run dev

# Terminal 2 - Frontend  
cd client
npm start
```

### Step 5: Test Voice Chat

1. Navigate to `http://localhost:4200/panic`
2. Click **"Talk to AI"** button
3. Click the **🎤 microphone icon** in the chat header
4. Grant microphone permissions when prompted
5. **Start speaking** - the AI will:
   - Convert your speech to text (STT)
   - Send to OpenAI for response
   - Convert AI response to speech (TTS)
   - Play the audio response

## How It Works

### Pipeline Flow:
```
User Speaks
    ↓
Microphone Capture (16kHz PCM)
    ↓
Socket.IO → Backend
    ↓
Azure Speech STT (Speech-to-Text)
    ↓
OpenAI API (Generate Response)
    ↓
Azure Speech TTS (Text-to-Speech)
    ↓
Socket.IO → Frontend
    ↓
Audio Playback
```

### Features:
- ✅ Real-time speech recognition
- ✅ Interim text display (shows what you're saying as you speak)
- ✅ OpenAI integration with conversation history
- ✅ Text-to-speech with natural voice
- ✅ Low-latency streaming
- ✅ Visual status indicators (Listening/Speaking/Ready)

## Troubleshooting

### "Azure Speech not available"
- Make sure you installed: `npm install microsoft-cognitiveservices-speech-sdk`
- Check that `AZURE_SPEECH_KEY` is set in `server/.env`
- Restart the backend server

### "Failed to access microphone"
- Check browser permissions (click the lock icon in address bar)
- Make sure you're using HTTPS in production (required for microphone)
- Try a different browser (Chrome/Edge work best)

### "Voice chat not connecting"
- Check browser console for errors
- Verify Socket.IO connection in Network tab
- Ensure backend is running on port 3000
- Check server logs for Azure Speech initialization

### Audio not playing
- Check browser audio permissions
- Verify audio context is created (check console)
- Try refreshing the page

## Voice Button Location

The voice button (🎤) is located in the **AI Support Chat** panel header, next to the close button.

When active, it shows a red pulsing dot (🔴) and displays status:
- **Listening...** - Ready to hear you speak
- **AI Speaking...** - Playing AI response
- **Ready** - Waiting for input

## Testing Checklist

- [ ] Microphone permission granted
- [ ] Voice button appears in chat header
- [ ] Status shows "Listening..." when ready
- [ ] Speech is converted to text (interim text appears)
- [ ] User text appears in chat
- [ ] AI response text appears in chat
- [ ] AI response audio plays
- [ ] Status updates correctly (Listening → Speaking → Ready)

## Next Steps

Once working, you can:
- Customize the voice (change `AZURE_SPEECH_VOICE` in .env)
- Adjust audio quality settings
- Add voice activity detection
- Implement push-to-talk mode


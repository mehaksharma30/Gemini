# Voice Chat Test Guide

## ✅ Setup Complete!

Your `.env` file has:
- ✅ `AZURE_SPEECH_KEY` - Configured
- ✅ `AZURE_SPEECH_REGION` - Set to `eastus`
- ✅ `OPENAI_API_KEY` - Configured
- ✅ `OPENAI_MODEL` - Set to `gpt-5-mini`

## 🚀 How to Test

### 1. Start the Servers

**Terminal 1 - Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd client
npm start
```

### 2. Test Voice Chat

1. **Open the app:** Go to `http://localhost:4200/panic`
2. **Click "Talk to AI"** button
3. **Click the 🎤 Voice button** (in chat header or input area)
4. **Grant microphone permission** when browser prompts
5. **Start speaking!**

### 3. What Should Happen

1. **You speak** → Microphone captures audio
2. **Interim text appears** → Shows what you're saying as you speak
3. **Final text appears** → Your message appears in chat
4. **AI responds** → Text appears in chat
5. **AI speaks** → Audio plays through speakers

## 🔍 Troubleshooting

### "Azure Speech not available"
- Check backend logs for initialization message
- Verify `AZURE_SPEECH_KEY` is correct in `.env`
- Restart backend server

### "Failed to access microphone"
- Click the lock icon in browser address bar
- Grant microphone permissions
- Try Chrome or Edge browser

### "Voice chat not connecting"
- Check browser console (F12)
- Verify Socket.IO connection in Network tab
- Check backend is running on port 3000

### Audio not playing
- Check browser audio permissions
- Verify audio context in console
- Check backend logs for TTS errors

## 📊 Expected Flow

```
User clicks 🎤 Voice button
    ↓
Browser requests microphone permission
    ↓
User grants permission
    ↓
Frontend: "Voice chat ready. Start speaking..."
    ↓
User speaks: "I'm feeling anxious"
    ↓
Status: "Listening..." (green dot)
    ↓
Interim text: "I'm feeling..."
    ↓
Final text: "I'm feeling anxious" (appears in chat)
    ↓
Status: "AI Speaking..." (orange dot)
    ↓
AI text appears in chat
    ↓
Audio plays: AI voice response
    ↓
Status: "Ready" (green dot)
```

## 🎯 Success Indicators

✅ Voice button visible and clickable
✅ Microphone permission granted
✅ Status shows "Listening..." when ready
✅ Interim text appears as you speak
✅ Your text appears in chat
✅ AI text appears in chat
✅ Audio plays from speakers
✅ Status updates correctly

## 🐛 Debug Commands

**Check backend logs:**
- Look for: `[Azure Speech] Initialized successfully`
- Look for: `[Voice Chat] Client connected`
- Look for: `[Voice Chat] User said: ...`
- Look for: `[Voice Chat] TTS audio sent`

**Check frontend console:**
- Look for: `[Voice Chat] Audio capture started`
- Look for: `[Voice Chat] Playing audio`
- Check for any red error messages

## 📝 Notes

- The voice button is in **two places**:
  1. Chat header (top right, small circular button)
  2. Input area (bottom, large "🎤 Voice" button)

- Both buttons do the same thing - use whichever you prefer!

- The system uses:
  - **Azure Speech STT** for speech-to-text
  - **OpenAI** for AI responses
  - **Azure Speech TTS** for text-to-speech

- All processing happens on the backend for security and performance.


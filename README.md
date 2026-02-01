# MindMemos 2.0

**MindMemos** is a peer-support mental health journaling app. Users can write public journal entries about what they are experiencing (e.g., *panic attacks*), read others' posts, and learn coping tips from people who have been through similar situations. Topic-based chat rooms enable real-time conversations, while search helps users discover related posts and discussions. An upvote/token system highlights posts that have helped others. *(This app is for peer support and is not a substitute for professional care.)*

## 🚀 Features

### Core Features
- **User Authentication**: Secure JWT-based authentication with login/register
- **Journal Posts**: Create, read, update, and delete public journal entries
- **Comments**: Comment on posts to provide support and feedback
- **Direct Messaging**: Real-time one-on-one messaging between users
- **Search & Discovery**: Keyword/tag search to find related posts and discussions
- **Upvotes & Tokens**: Upvote helpful posts and earn tokens for community contributions
- **XP & Levels**: Gamification system with XP, levels, and badges (none, silver, gold, diamond)
- **Emergency Contacts**: Add up to 3 emergency contacts for panic situations

### AI Companion
- **AI Chat Support**: Talk to an empathetic AI companion for immediate support
- **Voice Chat**: Speech-to-text and text-to-speech for hands-free interaction
- **Panic Mode**: Specialized AI support during panic attacks with tailored responses
- **Conversation History**: Context-aware conversations that remember your journey

### Real-Time Voice Calling ⭐ NEW
- **2-Way Voice Calls**: Real-time audio communication between users using WebRTC
- **Emergency Calling**: Call a specific emergency contact or broadcast to all contacts
- **Incoming Call Handling**: Accept/decline incoming calls with visual notifications
- **Mute/Unmute**: Control microphone during calls
- **Web PubSub Signaling**: Secure signaling channel for call setup (audio uses WebRTC peer-to-peer)

## 🛠️ Tech Stack

### Frontend
- **Angular 20** (TypeScript)
- **Angular Animations** & **Motion One** for smooth UI interactions
- **Azure Speech SDK** for voice chat (STT/TTS)
- **WebRTC** for real-time audio communication
- **Azure Web PubSub Client** for signaling

### Backend
- **Node.js** with **Express**
- **TypeScript**
- **MongoDB** with **Mongoose**
- **Socket.IO** for real-time chat rooms
- **Azure Web PubSub** for call signaling
- **JWT** for authentication
- **Google Gemini API** for AI responses
- **Google Cloud Speech-to-Text** and **Text-to-Speech** for STT/TTS (backend); Azure Speech optional for in-browser voice

## 📱 Quick Start: Testing on 2 Devices (ngrok)

**For testing WebRTC voice calls between your computer and phone:**

1. **Install dependencies** (first time only):
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

2. **Start backend with ngrok** (in `server/` directory):
   ```bash
   cd server
   npm run dev:ngrok
   ```
   This will:
   - Start the backend server
   - Start ngrok tunnel
   - Print the public HTTPS URL (e.g., `https://xxxx.ngrok-free.app`)
   - Automatically update frontend config to use the ngrok URL

3. **Start frontend** (in a new terminal, `client/` directory):
   ```bash
   cd client
   npm start
   ```
   Frontend will automatically use the ngrok URL for API calls.

4. **On your phone/other device**:
   - Open the ngrok URL shown in terminal (e.g., `https://xxxx.ngrok-free.app`)
   - You may need to click through ngrok's warning page
   - Log in and test voice calls!

**Note**: The ngrok URL changes each time you restart (unless you set `NGROK_AUTH_TOKEN` in `server/.env` for stable URLs).

## 📋 Prerequisites

- Node.js (v20+ recommended)
- MongoDB (local or cloud instance)
- Azure Web PubSub Service (for voice calling)
- Azure Speech Service (for voice chat features)
- Gemini API key and Google Cloud credentials (see LOCAL_TESTING.md)
- ngrok (installed via npm, or install globally: `npm install -g ngrok`)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd MindMemos2.0
   ```

2. **Install server dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install client dependencies**
   ```bash
   cd ../client
   npm install
   ```

## ⚙️ Environment Variables

### Backend (`server/.env`)

```env
# Database
MONGODB_URI=mongodb://localhost:27017/mindmemos

# Server
PORT=3000
FRONTEND_URL=http://localhost:4200
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# AI (Gemini)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash

# Google Cloud (STT/TTS) – path to service account JSON
GOOGLE_APPLICATION_CREDENTIALS=
GCP_PROJECT_ID=

# Azure Web PubSub (for voice calling)
AZURE_WEB_PUBSUB_ENDPOINT=https://your-instance.webpubsub.azure.com
AZURE_WEB_PUBSUB_ACCESS_KEY=your-access-key
AZURE_WEB_PUBSUB_HUB_NAME=panic

# Ngrok (optional, for stable URLs - get token from https://dashboard.ngrok.com/get-started/your-authtoken)
NGROK_AUTH_TOKEN=your-ngrok-auth-token

# Azure Speech (optional – for in-browser voice token / real-time voice chat)
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=eastus

# Email (optional, for alerts)
EMAIL_PROVIDER=ethereal
EMAIL_FROM=MindMemos Alerts <mindmemos.alerts@gmail.com>
EMAIL_USER=your-gmail-username
EMAIL_PASS=your-gmail-app-password
```

### Frontend (`client/src/environments/environment.ts`)

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  azureSpeechKey: 'your-azure-speech-key',
  azureSpeechRegion: 'eastus',
};
```

For **local testing** of chat, STT, and TTS (including curl examples), see **[LOCAL_TESTING.md](LOCAL_TESTING.md)**.

## 🚀 Running the Application

### Development Mode

1. **Start MongoDB** (if running locally)
   ```bash
   mongod
   ```

2. **Start the backend server**
   ```bash
   cd server
   npm run dev
   ```
   Server will run on `http://localhost:3000`

3. **Start the Angular frontend**
   ```bash
   cd client
   npm start
   ```
   Frontend will run on `http://localhost:4200`

### Production Build

1. **Build the backend**
   ```bash
   cd server
   npm run build
   npm start
   ```

2. **Build the frontend**
   ```bash
   cd client
   npm run build
   # Serve the dist/client folder with your preferred web server
   ```

## 🧪 Testing Voice Calls

### Option 1: Testing on 2 Devices (Recommended for Real Testing)

1. **Start backend with ngrok**:
   ```bash
   cd server
   npm run dev:ngrok
   ```
   Copy the ngrok URL shown (e.g., `https://xxxx.ngrok-free.app`)

2. **Start frontend** (in another terminal):
   ```bash
   cd client
   npm start
   ```

3. **On your phone**:
   - Open the ngrok URL in your phone's browser
   - Log in with a test account
   - Navigate to `/panic` page

4. **On your computer**:
   - Open `http://localhost:4200` in browser
   - Log in with a different test account
   - Navigate to `/panic` page
   - Add phone user as emergency contact

5. **Test the call**:
   - Computer: Click "Test Web PubSub Connection" → Select contact → "Start Call"
   - Phone: Should see incoming call modal → Click "Accept"
   - Both should hear each other's audio!

### Option 2: Testing Locally (2 Browser Windows)

1. Ensure both backend and frontend are running (use `npm run dev` in server, `npm start` in client)
2. Open two browser windows (or use incognito mode)
3. Log in as different users in each window
4. Add each other as emergency contacts (mark as "Helpful" in chat)

### Test Single Call
1. **Window 1 (Caller)**:
   - Navigate to `/panic` page
   - Click "Test Web PubSub Connection" (should show ✅ Connected)
   - Select a contact from the dropdown
   - Click "📞 Start Call"
   - Status should show "📞 Calling..."

2. **Window 2 (Callee)**:
   - Navigate to `/panic` page
   - Click "Test Web PubSub Connection"
   - Should see incoming call modal: "**[Caller Name]** is calling you"
   - Click "✅ Accept"

3. **Both Windows**:
   - Status should show "✅ Connected"
   - Speak into microphone in Window 1 → Window 2 should hear it
   - Speak into microphone in Window 2 → Window 1 should hear it
   - Test mute/unmute buttons
   - Click "❌ End Call" to disconnect

### Test Broadcast Call
1. **Window 1 (Caller)**:
   - Click "📢 Alert All"
   - All emergency contacts receive incoming call notification

2. **Multiple Windows (Callees)**:
   - First contact to accept connects
   - Other contacts receive "Call cancelled" notification

## 📁 Project Structure

```
MindMemos2.0/
├── client/                 # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── auth/       # Login/Register
│   │   │   ├── posts/      # Journal posts (CRUD)
│   │   │   ├── messages/   # Direct messaging
│   │   │   ├── panic/      # Panic mode & voice calling
│   │   │   ├── profile/    # User profiles
│   │   │   └── core/       # Services, guards, interceptors
│   │   └── environments/   # Environment configs
│   └── package.json
│
├── server/                 # Node.js/Express backend
│   ├── src/
│   │   ├── controllers/   # Route handlers
│   │   ├── models/        # MongoDB models
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   ├── middleware/   # Auth middleware
│   │   ├── socket/        # Socket.IO handlers
│   │   └── config/        # Database, AI provider config
│   └── package.json
│
└── README.md
```

## 🔐 Security Notes

- **JWT Secrets**: Use strong, random secrets in production
- **API Keys**: Never commit API keys to version control
- **CORS**: Configure CORS properly for production domains
- **HTTPS/WSS**: Always use secure connections in production
- **Web PubSub Keys**: Keep access keys secure, never expose in frontend

## 🐛 Troubleshooting

### Voice Call Issues
- **"Web PubSub not connected"**: Check backend `.env` has correct Azure Web PubSub credentials
- **"InvalidStateError: remote description was null"**: Fixed in latest version - ICE candidates are now queued properly
- **No audio**: Check browser microphone permissions and WebRTC connection state
- **Call not connecting**: Verify both users are connected to Web PubSub and have added each other as emergency contacts

### General Issues
- **MongoDB connection error**: Ensure MongoDB is running and `MONGODB_URI` is correct
- **AI not responding**: Check GEMINI_API_KEY and that the backend can reach the Gemini API
- **CORS errors**: Verify `FRONTEND_URL` in backend `.env` matches your frontend URL

## 📝 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Posts
- `GET /api/posts` - Get all posts
- `POST /api/posts` - Create post
- `GET /api/posts/:id` - Get post by ID
- `PUT /api/posts/:id` - Update post
- `DELETE /api/posts/:id` - Delete post
- `POST /api/posts/:id/like` - Like post

### Voice Calling
- `GET /api/webpubsub/negotiate` - Get Web PubSub client access URL
- `POST /api/webpubsub/token` - Generate Web PubSub token
- `GET /api/webpubsub/health` - Health check

### AI
- `POST /api/ai/panic-chat` - Panic mode AI chat
- `POST /api/ai/tts` - Text-to-speech

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is for educational purposes as part of CSE330 coursework.

## ⚠️ Disclaimer

**This app is for peer support and is not a substitute for professional mental health care.** If you are experiencing a mental health crisis, please contact:
- National Suicide Prevention Lifeline: 988
- Crisis Text Line: Text HOME to 741741
- Your local emergency services: 911

---

**Built with ❤️ for mental health support**

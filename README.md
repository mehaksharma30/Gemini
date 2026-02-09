# MindMemos (Gemini 3 Hackathon) — Web Platform

MindMemos is a gesture- and voice-first mental health support platform built around real lived experiences. The **web platform** combines guided journaling, community recovery stories, peer chat, emergency contacts, and an AI support layer powered by **Gemini 3 Pro** (configurable via `GEMINI_MODEL`). The goal is simple: make support accessible in moments when typing, searching, or navigating a complex UI feels impossible.

> **Note:** This README documents the **web repo** (Angular + Node/Express + MongoDB) and real-time voice stack. A dedicated watch app is not included in this repository. Wearable clients can integrate by calling the same REST + WebSocket endpoints.

---

## Why MindMemos

In real distress, people often can’t type or explain what’s happening. MindMemos is designed to reduce friction:
- Users can search symptoms in the AI chat (e.g., “racing heart”, “can’t breathe”) and get calm support.
- Users can be matched to **peers who have faced and recovered** from similar experiences.
- Trust is community-driven: helpful supporters earn XP and appear higher in search results.

---

## Key Features (Web)

### Guided journaling + community feed
- Create journal posts and recovery stories
- Browse a feed of lived experiences
- Discover content through search and tags

### Peer connection + emergency contacts
- Direct messaging (DMs)
- Conversations and chat rooms
- Save consistently helpful peers as emergency contacts

### AI support (Gemini)
- `/api/ai/chat` and `/api/ai/panic-chat`
- Prompts are grounded in:
  - The user’s recent posts (up to 10)
  - Relevant community posts (MongoDB)
- Friendly, understanding tone (not robotic/formal)

### Speech + voice experiences
- Speech-to-Text: `/api/ai/speech/transcribe`
- Text-to-Speech: `/api/ai/tts`
- Real-time voice: custom **Voice Gateway WebSocket**
- Voice chat + DMs via **Socket.IO**

### Walkie-talkie audio (cross-client friendly)
- Audio pipeline supports conversion to **M4A** for broader client playback
- Useful for clients that prefer M4A playback format

---

## Tech Stack

### Frontend
- **Angular 20** (TypeScript)
- Lazy-loaded routes (feed, panic, search, messages, emergency contacts, breathing, voice gateway, walkie-talkie, etc.)
- Auth guards (`authGuard`, `guestGuard`) + JWT auth

### Backend
- **Node.js + Express**
- REST routes mounted under `/api/*`
- Real-time:
  - Socket.IO for DMs and voice chat
  - WebSocket Voice Gateway for low-latency audio relay

### Database
- **MongoDB** via **Mongoose**
- Models include:
  - User, Post, Comment
  - DirectMessage, Conversation, ChatRoom
  - EmergencyContacts
  - PanicIncident / PanicAlert
  - WalkieTalkieMessage
  - ChatRating (XP/helpful signals)

### AI
- **Gemini** via REST (`v1beta` `generateContent`)
- Configured via:
  - `GEMINI_API_KEY`
  - `GEMINI_MODEL` (set this to the Gemini 3 Pro model you’re using)
- Responses parsed from `candidates[0].content.parts[0].text`

### Hosting / Deployment
- **Google Cloud Compute Engine (GCE)** — single VM
- Dockerized backend
- **Caddy** reverse proxy (HTTPS / SSL)
- Deployment scripts + docs included in repo (`DEPLOY_FRESH_GCE.md`, `scripts/deploy-gce.sh`, etc.)

---

## Architecture (High Level)

```
Angular Web Client
  ├── REST: /api/*  ───────────────────────────▶ Node/Express API
  │                                                     │
  │                                                     ├── MongoDB (Mongoose)
  │                                                     │     - posts, DMs, panic, emergency, etc.
  │                                                     │
  │                                                     ├── Gemini (REST v1beta)
  │                                                     │     - grounded chat + panic chat
  │                                                     │
  │                                                     └── STT/TTS endpoints
  │
  ├── Socket.IO (DMs + voice chat) ─────────────▶ Node/Express + Socket.IO
  │
  └── Voice Gateway WebSocket (low latency PCM) ─▶ Voice Gateway service
```

---

## Repo Structure (Typical)

- `client/` — Angular app
- `server/` — Express API + services + routes + models
- `scripts/` — deployment helpers
- `DEPLOY_FRESH_GCE.md` — GCE deployment guide (if present)

(Your repo may have additional folders for specific features like walkie-talkie, voice gateway, panic flow, etc.)

---

## Getting Started (Local Development)

### Prerequisites
- Node.js (LTS recommended)
- npm or yarn
- MongoDB (local instance or hosted MongoDB URI)
- A Gemini API key
- (Optional) Google Cloud credentials if you are using managed STT/TTS services in your environment

---

## 1) Environment Variables

Create `server/.env` (or set these in your deployment environment):

```bash
# Server
NODE_ENV=development
PORT=3000

# Database
MONGODB_URI="mongodb://localhost:27017/mindmemos"

# Auth (examples)
JWT_SECRET="your_jwt_secret"

# Gemini (Gemini 3 Pro)
GEMINI_API_KEY="your_gemini_api_key"
GEMINI_MODEL="gemini-3-pro"   # set to the Gemini 3 Pro model ID you are using

# Optional voice gateway / realtime configs (if used)
# VOICE_GATEWAY_* = ...
```

For the Angular client, configure API URLs in:
- `client/src/environments/environment.ts`
- `client/src/environments/environment.prod.ts`

Typical keys:
- `apiUrl`
- `voiceGatewayUrl`

---

## 2) Install Dependencies

### Client
```bash
cd client
npm install
```

### Server
```bash
cd server
npm install
```

---

## 3) Run Locally

### Start the server
```bash
cd server
npm run dev
```

### Start the client
```bash
cd client
npm start
```

Then open the client in your browser (Angular dev server output will show the URL).

---

## API Overview (Common)

> Exact routes may vary; see `server/src/routes/*` for authoritative paths.

### AI
- `POST /api/ai/chat`  
- `POST /api/ai/panic-chat`  
- `POST /api/ai/speech/transcribe` (STT)  
- `POST /api/ai/tts` (TTS)

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- etc.

### Posts / Feed
- `GET /api/posts`
- `POST /api/posts`
- etc.

### Messaging
- REST + Socket.IO for DMs and conversations

### Realtime Voice
- Voice Gateway WebSocket endpoints (see `server/src/services/voiceGateway.service.ts`)

---

## Low-Latency + Reliability Notes (What we optimized)

Real-time support only works if it feels immediate. We tuned for low latency and resilience:
- Voice Gateway uses **compression disabled** (`perMessageDeflate: false`) to reduce latency.
- Ping/pong keepalive to maintain stable realtime sessions.
- Client reconnection with exponential backoff for voice gateway and Socket.IO.
- Jitter buffer tuning for smoother realtime audio delivery.
- HTTPS is required for reliable browser audio capture/streaming in many environments.

---

## HTTPS / SSL (Important for Audio)

Browsers restrict microphone and audio streaming features without HTTPS.  
For production:
- Put the app behind **Caddy** (or equivalent) with TLS enabled
- Ensure all voice and media endpoints are served via HTTPS/WSS

---

## Deployment (Google Cloud GCE)

MindMemos is designed to run as a single-VM deployment:
- Angular frontend served behind Caddy (or via separate static hosting, depending on setup)
- Node/Express backend in Docker
- MongoDB as hosted (recommended) or deployed separately

If your repo includes:
- `DEPLOY_FRESH_GCE.md`
- `scripts/deploy-gce.sh`
- `scripts/run-mindmemos-container.sh`

Follow those docs/scripts for a fresh deployment. Typical high-level steps:
1. Provision a GCE VM
2. Install Docker + Docker Compose (if used)
3. Configure environment variables securely
4. Run the backend container
5. Configure Caddy reverse proxy + TLS
6. Point your domain / DNS at the VM

---

## Safety & Responsibility

MindMemos is designed as **supportive guidance and peer connection**, not a replacement for medical care.  
If you are deploying publicly:
- Add clear disclaimers and crisis resource links
- Add moderation and abuse reporting flows
- Avoid medical diagnosis; focus on grounding + safe supportive language

---

## Roadmap (Web)

- Smarter peer matching based on symptom search + lived experiences
- Stronger verification/moderation so trust scales safely
- Deeper insights: trends, triggers, what helps over time
- Multilingual support and accessibility improvements
- Performance improvements across voice + chat flows

---

## Hackathon Note (Gemini 3)

Gemini is used for:
- Calm and supportive responses (tone shaping)
- Grounded prompts using recent user and community posts
- Panic-chat style conversational support
- STT/TTS endpoints for voice-first interaction

Make sure your deployment sets:
```bash
GEMINI_MODEL=gemini-3-pro
```
(or the exact Gemini 3 Pro model identifier you used)

---

## License

Add your project license here (MIT/Apache-2.0/etc.).

---

## Acknowledgements

- Google Cloud (GCE)
- Gemini API
- Open-source libraries used across Angular, Express, Socket.IO, and WebSocket services

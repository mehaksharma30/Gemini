import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/database';
import { initializeAIProvider } from './config/aiProvider';
import authRoutes from './routes/auth.routes';
import postRoutes from './routes/post.routes';
import uploadRoutes from './routes/upload.routes';
import commentRoutes from './routes/comment.routes';
import dmRoutes from './routes/dm.routes';
import userRoutes from './routes/user.routes';
import aiRoutes from './routes/ai.routes';
import chatRatingRoutes from './routes/chatRating.routes';
import searchRoutes from './routes/search.routes';
import emergencyRoutes from './routes/emergency.routes';
import panicRoutes from './routes/panic.routes';
import alertsRoutes from './routes/alerts.routes';
import walkieTalkieRoutes from './routes/walkieTalkie.routes';
import { setupDMSocket } from './socket/dmSocket';
import { setupVoiceChatSocket } from './socket/voiceChatSocket';
import { initializeVoiceGateway } from './services/voiceGateway.service';

dotenv.config();

// Initialize and log AI provider
initializeAIProvider();

const app = express();
const httpServer = createServer(app);

// Allowed origins for CORS (both local dev and production)
const allowedOrigins: string[] = [
  'http://localhost:4200', // Always allow localhost for development
];

// Parse FRONTEND_ORIGINS environment variable (comma-separated list)
if (process.env.FRONTEND_ORIGINS) {
  const envOrigins = process.env.FRONTEND_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
  allowedOrigins.push(...envOrigins);
}

// Also support legacy FRONTEND_URL for backward compatibility
if (process.env.FRONTEND_URL) {
  const legacyUrl = process.env.FRONTEND_URL.trim();
  if (!allowedOrigins.includes(legacyUrl)) {
    allowedOrigins.push(legacyUrl);
  }
}

const PORT = Number(process.env.PORT) || 3000;

// CORS configuration
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers (IE11) choke on 204
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Socket.IO CORS configuration
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io',
  allowUpgrades: true,
  upgradeTimeout: 10000,
  pingTimeout: 60000,
  pingInterval: 25000,
  serveClient: false,
  cookie: {
    name: 'io',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  maxHttpBufferSize: 1e6, // 1MB
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

connectDB();

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/chat/ratings', chatRatingRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/panic', panicRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/wt', walkieTalkieRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'MindMemos API is running',
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    websocket: true
  });
});

// Health check for Voice Gateway WebSocket endpoint
app.get('/voice-gateway/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Voice Gateway WebSocket endpoint is available',
    websocket: true,
    supportedPaths: ['/voice-gateway', '/vo_<session>'],
    port: PORT
  });
});

setupDMSocket(io);
setupVoiceChatSocket(io);

// Initialize Voice Gateway WebSocket server
initializeVoiceGateway(httpServer);

// Add middleware to log all incoming requests (for debugging WebSocket upgrade attempts)
app.use((req, res, next) => {
  // Log WebSocket upgrade attempts and /voice-gateway requests
  if (req.headers.upgrade === 'websocket' || req.path?.startsWith('/voice-gateway')) {
    console.log(`[HTTP] ${req.method} ${req.path} - Upgrade: ${req.headers.upgrade}, Connection: ${req.headers.connection}`);
    console.log(`[HTTP] Headers:`, JSON.stringify({
      host: req.headers.host,
      origin: req.headers.origin,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-forwarded-proto': req.headers['x-forwarded-proto'],
      upgrade: req.headers.upgrade,
      connection: req.headers.connection,
    }, null, 2));
  }
  next();
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT} (from process.env.PORT: ${process.env.PORT || 'not set, using default 3000'})`);
  console.log(`✅ Voice Gateway WebSocket available at:`);
  console.log(`   - ws://localhost:${PORT}/voice-gateway (with ?callId=...&userId=...)`);
  console.log(`   - ws://localhost:${PORT}/vo_<session> (with ?userId=...)`);
  console.log(`✅ Socket.IO available at /socket.io`);
  console.log(`✅ Allowed CORS origins: ${allowedOrigins.join(', ')}`);
  console.log(`✅ WebSocket enabled: true`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Process PID: ${process.pid}`);
  console.log(`✅ Node version: ${process.version}`);
});

export default app;

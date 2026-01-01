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
import webPubSubRoutes from './routes/webPubSub.routes';
import { setupDMSocket } from './socket/dmSocket';
import { setupVoiceChatSocket } from './socket/voiceChatSocket';
import { initializeAzureSpeech } from './services/azureSpeech.service';

dotenv.config();

// Initialize and log AI provider
initializeAIProvider();

// Initialize Azure Speech Services
initializeAzureSpeech();

const app = express();
const httpServer = createServer(app);

// Allowed origins for CORS (both local dev and production)
const allowedOrigins: string[] = [
  'http://localhost:4200', // Always allow localhost for development
  'https://purple-moss-01574bd1e.4.azurestaticapps.net', // Production frontend
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
app.use('/api/webpubsub', webPubSubRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'MindMemos API is running' });
});

setupDMSocket(io);
setupVoiceChatSocket(io);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;

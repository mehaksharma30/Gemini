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
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true,
}));
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'MindMemos API is running' });
});

setupDMSocket(io);
setupVoiceChatSocket(io);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;

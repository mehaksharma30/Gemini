import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { generateToken, sendToGroup, healthCheck } from '../controllers/webPubSub.controller';

const router = express.Router();

// Generate Web PubSub client access token (requires authentication)
router.post('/token', authMiddleware, generateToken);

// Send message to a group (requires authentication)
router.post('/send', authMiddleware, sendToGroup);

// Health check (public)
router.get('/health', healthCheck);

export default router;


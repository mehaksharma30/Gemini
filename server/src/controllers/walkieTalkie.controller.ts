import { Request, Response } from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import WalkieTalkieMessage from '../models/WalkieTalkieMessage';

// Ensure uploads directory exists on module load
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('[WalkieTalkie] Created uploads directory:', uploadsDir);
  } catch (err: any) {
    console.error('[WalkieTalkie] Failed to create uploads directory:', err);
  }
}

/**
 * Generate a consistent thread ID between two users
 * Thread ID is deterministic: sorted user IDs joined with underscore
 */
function generateThreadId(userAId: string, userBId: string): string {
  const sorted = [userAId, userBId].sort();
  return `wt_${sorted[0]}_${sorted[1]}`;
}

/**
 * Generate unique message ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * POST /api/wt/send
 * Upload audio message from one user to another
 * 
 * Body (multipart/form-data):
 * - fromUserId: string (required)
 * - toUserId: string (required)
 * - threadId: string (optional, will be generated if not provided)
 * - clientTimestamp: number (optional)
 * - audio: File (required, wav or m4a)
 * 
 * Response:
 * {
 *   threadId: string,
 *   messageId: string,
 *   createdAt: string (ISO),
 *   audioUrl: string
 * }
 */
export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const authenticatedUserId = req.user.userId;
    
    // Get fromUserId and toUserId from request body
    const fromUserId = req.body.fromUserId as string;
    const toUserId = req.body.toUserId as string;
    let threadId = req.body.threadId as string | undefined;
    const clientTimestamp = req.body.clientTimestamp ? Number(req.body.clientTimestamp) : undefined;

    // Validate required fields
    if (!fromUserId || !toUserId) {
      res.status(400).json({ error: 'Missing fromUserId or toUserId' });
      return;
    }

    // Validate authenticated user is the sender
    if (fromUserId !== authenticatedUserId) {
      res.status(403).json({ error: 'You can only send messages as yourself' });
      return;
    }

    // Validate user IDs are valid ObjectIds
    if (!mongoose.Types.ObjectId.isValid(fromUserId) || !mongoose.Types.ObjectId.isValid(toUserId)) {
      res.status(400).json({ error: 'Invalid user ID format' });
      return;
    }

    // Validate users are different
    if (fromUserId === toUserId) {
      res.status(400).json({ error: 'Cannot send message to yourself' });
      return;
    }

    // Check if audio file was uploaded
    if (!req.file) {
      res.status(400).json({ error: 'Missing audio file' });
      return;
    }

    console.log('[WalkieTalkie] Audio received:', {
      fromUserId,
      toUserId,
      filename: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });

    // Generate threadId if not provided
    if (!threadId) {
      threadId = generateThreadId(fromUserId, toUserId);
    }

    // Generate message ID
    const messageId = generateMessageId();

    // Store audio file path
    const audioPath = req.file.path;
    const audioFilename = path.basename(audioPath);
    const audioUrl = `/api/wt/audio/${messageId}`;

    // Verify file exists
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found at path: ${audioPath}`);
    }

    console.log('[WalkieTalkie] Saving message to database:', {
      messageId,
      threadId,
      fromUserId,
      toUserId,
      audioPath,
      audioUrl,
    });

    // Create message record in database
    const message = await WalkieTalkieMessage.create({
      messageId,
      threadId,
      fromUserId: new mongoose.Types.ObjectId(fromUserId),
      toUserId: new mongoose.Types.ObjectId(toUserId),
      audioUrl,
      audioPath,
      clientTimestamp,
      createdAt: new Date(),
    });

    console.log('[WalkieTalkie] Message saved:', messageId);

    // Return response
    res.json({
      threadId,
      messageId,
      createdAt: message.createdAt.toISOString(),
      audioUrl,
    });

  } catch (error: any) {
    console.error('[WalkieTalkie] sendMessage error:', error);
    console.error('[WalkieTalkie] Error stack:', error.stack);
    console.error('[WalkieTalkie] Request details:', {
      hasFile: !!req.file,
      filePath: req.file?.path,
      body: req.body,
      userId: req.user?.userId,
    });
    
    // Cleanup file on error
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('[WalkieTalkie] Error deleting file:', unlinkError);
      }
    }
    
    res.status(500).json({
      error: 'Failed to send message',
      details: error.message || 'Unknown error',
      // Include more details in development
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  }
};

/**
 * GET /api/wt/thread?userA=<id>&userB=<id>
 * Get thread between two users (all messages)
 * 
 * Query params:
 * - userA: string (required)
 * - userB: string (required)
 * 
 * Response:
 * {
 *   threadId: string,
 *   messages: [
 *     {
 *       messageId: string,
 *       fromUserId: string,
 *       toUserId: string,
 *       audioUrl: string,
 *       createdAt: string (ISO)
 *     }
 *   ]
 * }
 */
export const getThread = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const authenticatedUserId = req.user.userId;
    const userA = req.query.userA as string;
    const userB = req.query.userB as string;

    // Validate query params
    if (!userA || !userB) {
      res.status(400).json({ error: 'Missing userA or userB query parameter' });
      return;
    }

    // Validate user IDs
    if (!mongoose.Types.ObjectId.isValid(userA) || !mongoose.Types.ObjectId.isValid(userB)) {
      res.status(400).json({ error: 'Invalid user ID format' });
      return;
    }

    // Validate authenticated user is one of the participants
    if (authenticatedUserId !== userA && authenticatedUserId !== userB) {
      res.status(403).json({ error: 'You can only access threads you are part of' });
      return;
    }

    // Generate thread ID (deterministic)
    const threadId = generateThreadId(userA, userB);

    // Get all messages for this thread
    const messages = await WalkieTalkieMessage.find({
      threadId,
    })
      .sort({ createdAt: 1 }) // Oldest first
      .lean();

    // Format messages
    const formattedMessages = messages.map(msg => ({
      messageId: msg.messageId,
      fromUserId: msg.fromUserId.toString(),
      toUserId: msg.toUserId.toString(),
      audioUrl: msg.audioUrl,
      createdAt: msg.createdAt.toISOString(),
    }));

    res.json({
      threadId,
      messages: formattedMessages,
    });

  } catch (error: any) {
    console.error('[WalkieTalkie] getThread error:', error);
    res.status(500).json({
      error: 'Failed to get thread',
      details: error.message || 'Unknown error',
    });
  }
};

/**
 * GET /api/wt/poll?threadId=<id>&after=<timestamp or messageId>
 * Get new messages in a thread after a specific timestamp or messageId
 * 
 * Query params:
 * - threadId: string (required)
 * - after: string (optional, ISO timestamp or messageId)
 * 
 * Response:
 * {
 *   messages: [
 *     {
 *       messageId: string,
 *       fromUserId: string,
 *       toUserId: string,
 *       audioUrl: string,
 *       createdAt: string (ISO)
 *     }
 *   ]
 * }
 */
export const pollMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const authenticatedUserId = req.user.userId;
    const threadId = req.query.threadId as string;
    const after = req.query.after as string | undefined;

    // Validate threadId
    if (!threadId) {
      res.status(400).json({ error: 'Missing threadId query parameter' });
      return;
    }

    // Build query
    const query: any = { threadId };

    // If 'after' is provided, filter messages after that point
    if (after) {
      // Check if 'after' is a messageId
      const afterMessage = await WalkieTalkieMessage.findOne({ messageId: after }).lean();
      if (afterMessage) {
        // 'after' is a messageId, get messages after this message's timestamp
        query.createdAt = { $gt: afterMessage.createdAt };
      } else {
        // 'after' is likely a timestamp, try to parse it
        const afterDate = new Date(after);
        if (!isNaN(afterDate.getTime())) {
          query.createdAt = { $gt: afterDate };
        }
      }
    }

    // Get messages
    const messages = await WalkieTalkieMessage.find(query)
      .sort({ createdAt: 1 }) // Oldest first
      .lean();

    // Verify user has access to this thread
    const hasAccess = messages.some(
      msg => msg.fromUserId.toString() === authenticatedUserId || msg.toUserId.toString() === authenticatedUserId
    );

    if (messages.length > 0 && !hasAccess) {
      res.status(403).json({ error: 'You do not have access to this thread' });
      return;
    }

    // Format messages
    const formattedMessages = messages.map(msg => ({
      messageId: msg.messageId,
      fromUserId: msg.fromUserId.toString(),
      toUserId: msg.toUserId.toString(),
      audioUrl: msg.audioUrl,
      createdAt: msg.createdAt.toISOString(),
    }));

    res.json({
      messages: formattedMessages,
    });

  } catch (error: any) {
    console.error('[WalkieTalkie] pollMessages error:', error);
    res.status(500).json({
      error: 'Failed to poll messages',
      details: error.message || 'Unknown error',
    });
  }
};

/**
 * GET /api/wt/audio/:messageId
 * Serve audio file for a message
 * 
 * Params:
 * - messageId: string (required)
 * 
 * Response:
 * - Audio file stream
 */
export const getAudio = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const authenticatedUserId = req.user.userId;
    const messageId = req.params.messageId;

    if (!messageId) {
      res.status(400).json({ error: 'Missing messageId' });
      return;
    }

    // Get message from database
    const message = await WalkieTalkieMessage.findOne({ messageId }).lean();

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // Verify user has access (must be sender or receiver)
    const fromUserIdStr = message.fromUserId.toString();
    const toUserIdStr = message.toUserId.toString();

    if (authenticatedUserId !== fromUserIdStr && authenticatedUserId !== toUserIdStr) {
      res.status(403).json({ error: 'You do not have access to this message' });
      return;
    }

    // Get audio file path
    const audioPath = message.audioPath || path.join(__dirname, '..', '..', 'uploads', path.basename(message.audioUrl));

    // Check if file exists
    if (!fs.existsSync(audioPath)) {
      res.status(404).json({ error: 'Audio file not found' });
      return;
    }

    // Determine content type based on file extension
    const ext = path.extname(audioPath).toLowerCase();
    let contentType = 'audio/webm'; // Default to webm (browser default)
    if (ext === '.wav') {
      contentType = 'audio/wav';
    } else if (ext === '.m4a' || ext === '.mp4') {
      contentType = 'audio/mp4';
    } else if (ext === '.webm') {
      contentType = 'audio/webm';
    } else if (ext === '.mp3' || ext === '.mpeg') {
      contentType = 'audio/mpeg';
    }

    console.log('[WalkieTalkie] Serving audio:', {
      messageId,
      audioPath,
      contentType,
      ext,
      fileExists: fs.existsSync(audioPath),
    });

    // Set headers and stream file
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(audioPath)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    // Get file stats for content length
    const stats = fs.statSync(audioPath);
    res.setHeader('Content-Length', stats.size);
    
    const fileStream = fs.createReadStream(audioPath);
    
    fileStream.on('error', (err) => {
      console.error('[WalkieTalkie] Error streaming audio file:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming audio file' });
      }
    });
    
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('[WalkieTalkie] getAudio error:', error);
    res.status(500).json({
      error: 'Failed to get audio',
      details: error.message || 'Unknown error',
    });
  }
};

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import WalkieTalkieMessage from '../models/WalkieTalkieMessage';

const execFileAsync = promisify(execFile);

// Import ffmpeg-static (bundled binary)
let ffmpegPath: string;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffmpegStatic = require('ffmpeg-static');
  ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic as any).default || 'ffmpeg';
  console.log('[WalkieTalkie] ffmpeg-static loaded:', ffmpegPath);
} catch (error) {
  console.error('[WalkieTalkie] ffmpeg-static not found. WebM conversion will fail.');
  ffmpegPath = 'ffmpeg'; // Fallback to system ffmpeg if available
}

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
 * Cleanup old audio files - keep only the most recent one
 * Deletes the second oldest and all older files
 */
async function cleanupOldAudioFiles(): Promise<void> {
  try {
    console.log('[WalkieTalkie] 🧹 CLEANUP: Starting cleanup process...');
    console.log('[WalkieTalkie] 🧹 CLEANUP: Uploads directory:', uploadsDir);
    console.log('[WalkieTalkie] 🧹 CLEANUP: Uploads directory exists:', fs.existsSync(uploadsDir));
    console.log('[WalkieTalkie] 🧹 CLEANUP: Uploads directory is directory:', fs.existsSync(uploadsDir) ? fs.statSync(uploadsDir).isDirectory() : 'N/A');
    
    // Check if uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      console.log('[WalkieTalkie] 🧹 CLEANUP: Uploads directory does not exist, skipping cleanup');
      return;
    }

    // Get all files in uploads directory
    const allFiles = fs.readdirSync(uploadsDir);
    console.log('[WalkieTalkie] 🧹 CLEANUP: Total files in directory:', allFiles.length);
    
    // Get all walkie-talkie audio files from uploads directory
    const files = allFiles.filter(file => file.startsWith('wt_'));
    console.log('[WalkieTalkie] 🧹 CLEANUP: Walkie-talkie files found:', files.length, files);
    
    if (files.length <= 1) {
      // Keep at least one file, no cleanup needed
      console.log('[WalkieTalkie] 🧹 CLEANUP: Only', files.length, 'file(s) found, no cleanup needed');
      return;
    }

    // Get all audio paths currently in database
    const dbAudioPaths = await WalkieTalkieMessage.find({})
      .select('audioPath')
      .lean();
    const dbPathsSet = new Set(
      dbAudioPaths
        .map(msg => msg.audioPath)
        .filter((p): p is string => Boolean(p))
        .map(p => path.basename(p))
    );

    // Get file stats and filter to only walkie-talkie audio files
    const fileStats = files
      .map(file => {
        const filePath = path.join(uploadsDir, file);
        try {
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            mtime: stats.mtime.getTime(),
            size: stats.size,
            isInDatabase: dbPathsSet.has(file),
          };
        } catch (err: any) {
          console.warn('[WalkieTalkie] 🧹 CLEANUP: Error getting stats for file:', file, err.message);
          // File might have been deleted, skip it
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    console.log('[WalkieTalkie] 🧹 CLEANUP: File stats collected:', fileStats.length, 'files');
    console.log('[WalkieTalkie] 🧹 CLEANUP: Files with stats:', fileStats.map(f => ({
      name: f.name,
      size: f.size,
      mtime: new Date(f.mtime).toISOString(),
      inDb: f.isInDatabase,
    })));

    // Sort by modification time (newest first)
    fileStats.sort((a, b) => b.mtime - a.mtime);
    console.log('[WalkieTalkie] 🧹 CLEANUP: Files sorted by date (newest first):', fileStats.map(f => f.name));

    // Keep the newest file, delete the second oldest and all older ones
    const filesToKeep = 1; // Keep only the most recent
    const filesToDelete = fileStats.slice(filesToKeep);

    if (filesToDelete.length === 0) {
      return;
    }

    console.log('[WalkieTalkie] 🧹 CLEANUP: Starting audio file cleanup:', {
      totalFiles: fileStats.length,
      filesToKeep: filesToKeep,
      filesToDelete: filesToDelete.length,
      filesBeingKept: fileStats.slice(0, filesToKeep).map(f => f.name),
    });

    let deletedCount = 0;
    let errorCount = 0;

    console.log('[WalkieTalkie] 🧹 CLEANUP: Files to delete:', filesToDelete.map(f => ({
      name: f.name,
      path: f.path,
      exists: fs.existsSync(f.path),
    })));

    for (const fileInfo of filesToDelete) {
      try {
        // Check if file still exists
        if (!fs.existsSync(fileInfo.path)) {
          console.log('[WalkieTalkie] 🧹 CLEANUP: File already deleted, skipping:', fileInfo.name);
          deletedCount++; // Count as deleted since it's already gone
          continue;
        }

        // Delete all old files (keep only the most recent one)
        // Note: This will delete files even if they're in the database
        // The database will be updated when files are converted/cleaned up
        console.log('[WalkieTalkie] 🗑️ Attempting to delete file:', fileInfo.path);
        fs.unlinkSync(fileInfo.path);
        
        // Verify deletion
        if (fs.existsSync(fileInfo.path)) {
          throw new Error('File still exists after deletion attempt');
        }
        
        deletedCount++;
        console.log('[WalkieTalkie] 🗑️ ✅ Successfully deleted old audio file:', {
          fileName: fileInfo.name,
          sizeBytes: fileInfo.size,
          ageMs: Date.now() - fileInfo.mtime,
          wasInDatabase: fileInfo.isInDatabase,
          note: fileInfo.isInDatabase ? '⚠️ File was in database but deleted to keep only most recent' : '✅ Orphaned file deleted',
        });
      } catch (deleteError: any) {
        errorCount++;
        console.error('[WalkieTalkie] ❌ Error deleting file:', {
          fileName: fileInfo.name,
          filePath: fileInfo.path,
          fileExists: fs.existsSync(fileInfo.path),
          error: deleteError.message,
          errorStack: deleteError.stack,
        });
      }
    }

    console.log('[WalkieTalkie] ✅ CLEANUP COMPLETE:', {
      deletedCount,
      errorCount,
      remainingFiles: fileStats.length - deletedCount,
    });

  } catch (error: any) {
    console.error('[WalkieTalkie] ❌ Cleanup error:', error);
    // Don't throw - cleanup failures shouldn't break message sending
  }
}

/**
 * Check if file is WebM format
 */
function isWebMFormat(file: Express.Multer.File): boolean {
  const mimeType = file.mimetype?.toLowerCase() || '';
  const ext = path.extname(file.originalname).toLowerCase();
  return mimeType.includes('webm') || ext === '.webm';
}

/**
 * Convert WebM audio file to M4A (AAC) format for watchOS compatibility
 * @param inputPath Path to WebM file
 * @param outputPath Path where M4A file should be saved
 * @returns Promise<void>
 */
async function convertWebMToM4A(inputPath: string, outputPath: string): Promise<void> {
  console.log('[WalkieTalkie] Converting WebM to M4A:', {
    input: inputPath,
    output: outputPath,
  });

  try {
    // ffmpeg command: convert WebM to M4A (AAC codec)
    // -i: input file
    // -c:a aac: audio codec AAC
    // -b:a 128k: audio bitrate 128kbps
    // -ar 44100: sample rate 44.1kHz (watchOS compatible)
    // -y: overwrite output file if exists
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-y', // Overwrite output
      outputPath,
    ]);

    // Verify output file exists and has content
    if (!fs.existsSync(outputPath)) {
      throw new Error('Conversion failed: output file not created');
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      throw new Error('Conversion failed: output file is empty');
    }

    console.log('[WalkieTalkie] WebM to M4A conversion successful:', {
      inputSize: fs.statSync(inputPath).size,
      outputSize: stats.size,
      outputPath,
    });
  } catch (error: any) {
    console.error('[WalkieTalkie] WebM to M4A conversion error:', error);
    throw new Error(`Failed to convert WebM to M4A: ${error.message || error}`);
  }
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

    // ENHANCED LOGGING: Track file format at upload
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    const uploadedFormat = originalExt || 'unknown';
    console.log('[WalkieTalkie] 📥 AUDIO UPLOAD RECEIVED:', {
      messageId: 'pending',
      fromUserId,
      toUserId,
      originalFilename: req.file.originalname,
      uploadedFileExtension: originalExt,
      uploadedFormat: uploadedFormat,
      uploadedMimeType: req.file.mimetype,
      uploadedSizeBytes: req.file.size,
      storedPath: req.file.path,
      timestamp: new Date().toISOString(),
    });

    // Generate threadId if not provided
    if (!threadId) {
      threadId = generateThreadId(fromUserId, toUserId);
    }

    // Generate message ID
    const messageId = generateMessageId();

    // Store original audio file path
    const originalPath = req.file.path;
    let audioPath = originalPath;
    let shouldDeleteOriginal = false;

    // ENHANCED LOGGING: Track format before conversion
    const originalFormat = path.extname(originalPath).toLowerCase();
    console.log('[WalkieTalkie] 🔍 FORMAT DETECTION:', {
      messageId,
      originalFileExtension: originalFormat,
      originalMimeType: req.file.mimetype,
      isWebM: isWebMFormat(req.file),
      needsConversion: isWebMFormat(req.file),
    });

    // Check if file is WebM format (needs conversion for watchOS)
    if (isWebMFormat(req.file)) {
      console.log('[WalkieTalkie] ⚠️ WebM file detected, converting to M4A for watchOS compatibility');
      
      // Generate M4A output path
      const m4aPath = originalPath.replace(/\.webm$/i, '.m4a');
      
      try {
        // Convert WebM to M4A
        console.log('[WalkieTalkie] 🔄 STARTING CONVERSION:', {
          messageId,
          fromFormat: 'WebM',
          toFormat: 'M4A',
          inputPath: originalPath,
          outputPath: m4aPath,
        });
        await convertWebMToM4A(originalPath, m4aPath);
        
        // Verify conversion
        const m4aStats = fs.statSync(m4aPath);
        console.log('[WalkieTalkie] ✅ CONVERSION SUCCESS:', {
          messageId,
          originalSizeBytes: req.file.size,
          convertedSizeBytes: m4aStats.size,
          originalFormat: 'WebM',
          finalFormat: 'M4A',
          originalPath,
          convertedPath: m4aPath,
        });
        
        // Use converted M4A file as the final audio
        audioPath = m4aPath;
        shouldDeleteOriginal = true; // Delete original WebM after conversion
      } catch (conversionError: any) {
        console.error('[WalkieTalkie] ❌ CONVERSION FAILED:', {
          messageId,
          error: conversionError.message,
          originalPath,
          targetPath: m4aPath,
          fallbackAction: 'Using original WebM (will fail on watchOS)',
        });
        // If conversion fails, use original file (may fail on watchOS, but better than failing completely)
        audioPath = originalPath;
        shouldDeleteOriginal = false;
      }
    } else {
      // File is already in a compatible format
      const finalFormat = path.extname(audioPath).toLowerCase();
      console.log('[WalkieTalkie] ✅ NO CONVERSION NEEDED:', {
        messageId,
        fileFormat: finalFormat,
        isWatchOSCompatible: finalFormat === '.m4a' || finalFormat === '.mp4' || finalFormat === '.wav' || finalFormat === '.mp3',
      });
    }

    // Verify final audio file exists
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found at path: ${audioPath}`);
    }

    const audioUrl = `/api/wt/audio/${messageId}`;

    // ENHANCED LOGGING: Track what's being saved to database
    const finalFormat = path.extname(audioPath).toLowerCase();
    const finalStats = fs.statSync(audioPath);
    console.log('[WalkieTalkie] 💾 SAVING TO DATABASE:', {
      messageId,
      threadId,
      fromUserId,
      toUserId,
      storedFileFormat: finalFormat,
      storedFileSizeBytes: finalStats.size,
      storedFilePath: audioPath,
      storedFileExtension: finalFormat,
      audioUrl,
      isM4A: finalFormat === '.m4a',
      isWatchOSCompatible: finalFormat === '.m4a' || finalFormat === '.mp4' || finalFormat === '.wav' || finalFormat === '.mp3',
      databaseFields: {
        audioPath: audioPath,
        audioUrl: audioUrl,
      },
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

    // Delete original WebM file if conversion was successful
    if (shouldDeleteOriginal && fs.existsSync(originalPath)) {
      try {
        fs.unlinkSync(originalPath);
        console.log('[WalkieTalkie] Deleted original WebM file:', originalPath);
      } catch (deleteError) {
        console.warn('[WalkieTalkie] Failed to delete original WebM file:', deleteError);
        // Non-fatal: continue even if cleanup fails
      }
    }

    // Cleanup old audio files - keep only the most recent one
    // Run cleanup asynchronously (don't block response)
    // Add small delay to ensure current file is fully written
    console.log('[WalkieTalkie] 🧹 Triggering cleanup after message save...');
    setTimeout(() => {
      cleanupOldAudioFiles()
        .then(() => {
          console.log('[WalkieTalkie] 🧹 Cleanup completed successfully');
        })
        .catch(err => {
          console.error('[WalkieTalkie] ❌ Cleanup error (non-fatal):', err);
          console.error('[WalkieTalkie] ❌ Cleanup error stack:', err.stack);
        });
    }, 1000); // Wait 1 second to ensure file is fully written

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
    
    // Cleanup files on error
    if (req.file?.path) {
      try {
        // Delete original file
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        // Also check for converted M4A file (if conversion started but failed)
        const m4aPath = req.file.path.replace(/\.webm$/i, '.m4a');
        if (fs.existsSync(m4aPath) && m4aPath !== req.file.path) {
          fs.unlinkSync(m4aPath);
        }
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
    let audioPath = message.audioPath || path.join(__dirname, '..', '..', 'uploads', path.basename(message.audioUrl));

    // Check if file exists
    if (!fs.existsSync(audioPath)) {
      res.status(404).json({ error: 'Audio file not found' });
      return;
    }

    // STANDARDIZE TO M4A: Convert WebM to M4A on-the-fly if needed (for watchOS compatibility)
    const ext = path.extname(audioPath).toLowerCase();
    if (ext === '.webm') {
      const m4aPath = audioPath.replace(/\.webm$/i, '.m4a');
      
      // Check if converted M4A already exists
      if (!fs.existsSync(m4aPath)) {
        try {
          console.log('[WalkieTalkie] Converting WebM to M4A on-the-fly:', { messageId, original: audioPath, target: m4aPath });
          await convertWebMToM4A(audioPath, m4aPath);
          
          // Update database to point to M4A for future requests (non-blocking)
          WalkieTalkieMessage.updateOne(
            { messageId },
            { $set: { audioPath: m4aPath } }
          ).catch(err => {
            console.warn('[WalkieTalkie] Failed to update DB with M4A path (non-fatal):', err);
          });
          
          console.log('[WalkieTalkie] WebM converted to M4A successfully:', m4aPath);
        } catch (conversionError: any) {
          console.error('[WalkieTalkie] WebM to M4A conversion failed:', conversionError);
          // Fall back to serving WebM (will fail on watchOS but better than 500 error)
          // In production, you may want to return 503 or retry
        }
      }
      
      // Use M4A if conversion succeeded/exists, otherwise fall back to WebM
      if (fs.existsSync(m4aPath)) {
        audioPath = m4aPath;
      }
    }

    // Determine content type based on final file extension
    const finalExt = path.extname(audioPath).toLowerCase();
    let contentType = 'audio/mp4'; // Default to M4A/MP4 (watchOS compatible)
    if (finalExt === '.wav') {
      contentType = 'audio/wav';
    } else if (finalExt === '.m4a' || finalExt === '.mp4') {
      contentType = 'audio/mp4';
    } else if (finalExt === '.webm') {
      contentType = 'audio/webm'; // Fallback only (shouldn't happen after conversion)
    } else if (finalExt === '.mp3' || finalExt === '.mpeg') {
      contentType = 'audio/mpeg';
    }

    // ENHANCED LOGGING: Track what's being served to client
    const fileStats = fs.statSync(audioPath);
    
    // Read first 16 bytes for file signature detection
    const fileHandle = fs.openSync(audioPath, 'r');
    const fileBuffer = Buffer.alloc(16);
    fs.readSync(fileHandle, fileBuffer, 0, 16, 0);
    fs.closeSync(fileHandle);
    
    const fileSignature = fileBuffer.toString('hex').toUpperCase().match(/.{1,2}/g)?.join(' ') || '';
    
    // Detect format from file signature
    let detectedFormat = 'unknown';
    const signatureHex = fileBuffer.toString('hex').toUpperCase();
    if (signatureHex.startsWith('667479704D344120')) { // ftypM4A
      detectedFormat = 'M4A/AAC';
    } else if (signatureHex.startsWith('1A45DFA3')) { // WebM
      detectedFormat = 'WebM';
    } else if (signatureHex.startsWith('52494646') && signatureHex.includes('57415645')) { // RIFF...WAVE
      detectedFormat = 'WAV';
    } else if (signatureHex.startsWith('494433') || signatureHex.startsWith('FFFB') || signatureHex.startsWith('FFF3')) { // ID3 or MP3
      detectedFormat = 'MP3';
    }

    console.log('[WalkieTalkie] 📤 SERVING AUDIO TO CLIENT:', {
      messageId,
      authenticatedUserId,
      fromUserId: fromUserIdStr,
      toUserId: toUserIdStr,
      storedFilePath: audioPath,
      storedFileExtension: finalExt,
      storedFileSizeBytes: fileStats.size,
      fileSignatureHex: fileSignature,
      detectedFormatFromSignature: detectedFormat,
      responseContentType: contentType,
      contentTypeMatchesExtension: (
        (finalExt === '.m4a' || finalExt === '.mp4') && contentType === 'audio/mp4' ||
        finalExt === '.webm' && contentType === 'audio/webm' ||
        finalExt === '.wav' && contentType === 'audio/wav' ||
        (finalExt === '.mp3' || finalExt === '.mpeg') && contentType === 'audio/mpeg'
      ),
      isWatchOSCompatible: detectedFormat === 'M4A/AAC' || detectedFormat === 'WAV' || detectedFormat === 'MP3',
      isWebM: detectedFormat === 'WebM',
      warning: detectedFormat === 'WebM' ? '⚠️ WATCH WILL FAIL - WebM not supported on watchOS' : '✅ WatchOS compatible',
      timestamp: new Date().toISOString(),
    });

    // Set headers and stream file
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(audioPath)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', fileStats.size);
    
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

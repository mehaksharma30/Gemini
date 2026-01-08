import { Request, Response } from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import WalkieTalkieMessage from '../models/WalkieTalkieMessage';
import Post from '../models/Post';
import EmergencyContacts from '../models/EmergencyContacts';
import PanicAlert from '../models/PanicAlert';
import PanicIncident from '../models/PanicIncident';
import User from '../models/User';
import { speechToText } from '../services/azureSpeech.service';
import { synthesizeToMp3 } from '../services/azureTts.service';
import { getAIPanicResponse } from '../services/aiPanic.service';
import { sendEmergencyEmail } from '../services/emailService';
import { conversationStore } from '../services/aiPanic.service';

/**
 * Generate a unique thread ID for walkie-talkie conversation
 */
function generateThreadId(userId: string): string {
  return `wt_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Convert audio file to text using STT
 * Supports WAV (16kHz mono 16-bit) and M4A (will need conversion)
 */
async function transcribeAudioFile(filePath: string, mimeType: string): Promise<string> {
  try {
    // Read audio file
    const audioBuffer = fs.readFileSync(filePath);
    
    // For now, use Azure Speech STT directly
    // TODO: If M4A, convert to WAV first (requires ffmpeg or similar)
    // For V1, assume WAV format from watchOS
    if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav' || filePath.endsWith('.wav')) {
      // Convert Buffer to ArrayBuffer for Azure Speech SDK
      const arrayBuffer = audioBuffer.buffer.slice(
        audioBuffer.byteOffset,
        audioBuffer.byteOffset + audioBuffer.byteLength
      );
      
      const transcript = await speechToText(arrayBuffer);
      return transcript;
    } else if (mimeType === 'audio/m4a' || mimeType === 'audio/mp4' || filePath.endsWith('.m4a')) {
      // M4A conversion to WAV would go here
      // For V1, return placeholder or use existing Azure STT API that accepts M4A
      console.warn('[WalkieTalkie] M4A format detected - conversion not implemented, using Azure STT API directly');
      
      // Try Azure STT REST API which may accept M4A
      const region = process.env.AZURE_SPEECH_REGION || 'eastus';
      const key = process.env.AZURE_SPEECH_KEY;
      
      if (!key) {
        throw new Error('Azure Speech key not configured');
      }
      
      const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'audio/m4a',
          'Accept': 'application/json',
        },
        body: audioBuffer,
      });
      
      const json = await response.json() as { DisplayText?: string; RecognitionStatus?: string };
      
      if (json.RecognitionStatus === 'Success' && json.DisplayText) {
        return json.DisplayText;
      } else {
        throw new Error(`STT failed: ${json.RecognitionStatus || 'Unknown error'}`);
      }
    } else {
      throw new Error(`Unsupported audio format: ${mimeType}`);
    }
  } catch (error: any) {
    console.error('[WalkieTalkie] STT error:', error);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

/**
 * POST /api/wt/message
 * Accept audio or text message, transcribe if audio, get AI response, return JSON
 */
export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userId = req.user.userId;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // Get threadId from body (create new if not provided)
    let threadId = req.body.threadId as string | undefined;
    
    // Extract text or audio
    let userText: string | null = null;
    let audioFilePath: string | null = null;

    // Check if audio file was uploaded
    if (req.file) {
      audioFilePath = req.file.path;
      console.log('[WalkieTalkie] Audio file received:', req.file.originalname, 'size:', req.file.size, 'mime:', req.file.mimetype);
      
      try {
        // Transcribe audio
        userText = await transcribeAudioFile(req.file.path, req.file.mimetype);
        console.log('[WalkieTalkie] Transcription:', userText.substring(0, 50) + '...');
      } catch (sttError: any) {
        // Cleanup file on error
        if (audioFilePath) {
          fs.unlink(audioFilePath, () => {});
        }
        console.error('[WalkieTalkie] STT error:', sttError);
        res.status(400).json({ 
          error: 'Failed to transcribe audio',
          details: sttError.message 
        });
        return;
      }
    } else if (req.body.text && typeof req.body.text === 'string') {
      // Text message provided directly
      const textInput = req.body.text.trim();
      if (textInput.length > 0) {
        userText = textInput;
        console.log('[WalkieTalkie] Text message received:', textInput.substring(0, Math.min(50, textInput.length)) + '...');
      }
    }
    
    // Validate we have either audio transcription or text input
    // Type narrowing: after this check, userText is guaranteed non-null
    if (!userText || userText.length === 0) {
      // Cleanup file if exists
      if (audioFilePath) {
        fs.unlink(audioFilePath, () => {});
      }
      res.status(400).json({ 
        error: 'Missing audio or text',
        details: 'Please provide either an audio file (multipart/form-data field "audio") or text (body field "text")'
      });
      return;
    }

    // Generate threadId if not provided
    if (!threadId) {
      threadId = generateThreadId(userId);
    }

    // Get conversation history for AI context
    const history = conversationStore.get(threadId) || [];
    
    // Type narrowing: userText is guaranteed non-null after the validation check above
    const userTextFinal: string = userText!; // Non-null assertion is safe here
    history.push({ role: 'user', content: userTextFinal });

    // Save user message to database (userTextFinal is guaranteed non-null)
    const userMessage = await WalkieTalkieMessage.create({
      threadId,
      userId: userObjectId,
      role: 'user',
      text: userTextFinal,
      audioUrl: audioFilePath ? `/uploads/${path.basename(audioFilePath)}` : undefined,
      createdAt: new Date(),
    });

    console.log('[WalkieTalkie] User message saved:', userMessage._id);

    // Get user's recent posts for AI context
    let userPosts: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> = [];
    try {
      const posts = await Post.find({ authorId: userObjectId })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('title content tags createdAt')
        .lean();
      
      userPosts = posts.map(post => ({
        title: post.title,
        content: post.content,
        tags: post.tags || [],
        createdAt: post.createdAt,
      }));
    } catch (err) {
      console.error('[WalkieTalkie] Error fetching user posts:', err);
    }

    // Get AI response (userTextFinal is guaranteed non-null)
    let aiResponse: string;
    try {
      aiResponse = await getAIPanicResponse(
        userTextFinal,
        history.slice(0, -1), // Exclude current message
        { recentPosts: userPosts },
        threadId,
        userId,
        'en' // Always English
      );
      
      // Add AI response to history
      history.push({ role: 'assistant', content: aiResponse });
      conversationStore.set(threadId, history);
    } catch (aiError: any) {
      console.error('[WalkieTalkie] AI error:', aiError);
      aiResponse = "I'm here with you. How can I help right now?";
    }

    // Generate TTS audio for AI response
    let ttsAudioUrl: string | undefined = undefined;
    try {
      const ttsBuffer = await synthesizeToMp3(aiResponse, 'en');
      
      // Save TTS audio to uploads directory
      const ttsFilename = `tts_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.mp3`;
      const ttsPath = path.join(__dirname, '..', '..', 'uploads', ttsFilename);
      
      // Ensure uploads directory exists
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      fs.writeFileSync(ttsPath, ttsBuffer);
      ttsAudioUrl = `/uploads/${ttsFilename}`;
      
      console.log('[WalkieTalkie] TTS audio generated:', ttsAudioUrl);
    } catch (ttsError: any) {
      console.error('[WalkieTalkie] TTS error:', ttsError);
      // Continue without TTS - it's optional
    }

    // Save AI response to database
    await WalkieTalkieMessage.create({
      threadId,
      userId: userObjectId,
      role: 'assistant',
      text: aiResponse,
      audioUrl: ttsAudioUrl,
      createdAt: new Date(),
    });

    console.log('[WalkieTalkie] Response saved for thread:', threadId);

    // Return response (userTextFinal is guaranteed non-null)
    res.json({
      threadId,
      transcript: userTextFinal,
      responseText: aiResponse,
      ttsAudioUrl,
    });

  } catch (error: any) {
    console.error('[WalkieTalkie] sendMessage error:', error);
    
    // Cleanup file on error
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    
    res.status(500).json({
      error: 'Failed to process message',
      details: error.message || 'Unknown error',
    });
  }
};

/**
 * POST /api/wt/emergency
 * Accept audio clip, transcribe, trigger emergency workflow
 */
export const sendEmergency = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userId = req.user.userId;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // Check if audio file was uploaded
    if (!req.file) {
      res.status(400).json({ error: 'Missing audio file' });
      return;
    }

    console.log('[WalkieTalkie] Emergency audio received:', req.file.originalname, 'size:', req.file.size);

    // Transcribe audio
    let transcript: string;
    try {
      transcript = await transcribeAudioFile(req.file.path, req.file.mimetype);
      console.log('[WalkieTalkie] Emergency transcription:', transcript.substring(0, 50) + '...');
    } catch (sttError: any) {
      // Cleanup file on error
      fs.unlink(req.file.path, () => {});
      console.error('[WalkieTalkie] Emergency STT error:', sttError);
      res.status(400).json({ 
        error: 'Failed to transcribe audio',
        details: sttError.message 
      });
      return;
    }

    if (!transcript || transcript.length === 0) {
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: 'No speech detected in audio' });
      return;
    }

    // Create panic incident
    const emergencyContacts = await EmergencyContacts.findOne({ ownerUserId: userObjectId });
    const contactUserIds = emergencyContacts?.contactUserIds || [];

    const incident = await PanicIncident.create({
      ownerUserId: userObjectId,
      mode: contactUserIds.length > 0 ? 'GROUP' : 'AI',
      message: transcript,
      targetUserIds: contactUserIds,
      status: 'OPEN',
    });

    // Get AI response
    let aiResponse: string;
    try {
      aiResponse = await getAIPanicResponse(
        transcript,
        [],
        {},
        undefined,
        userId,
        'en'
      );
    } catch (aiError: any) {
      console.error('[WalkieTalkie] Emergency AI error:', aiError);
      aiResponse = "I'm here with you. Let's breathe together—inhale... hold... exhale... You're not alone, and this feeling will pass.";
    }

    // Notify emergency contacts
    let notificationsSent = 0;
    if (contactUserIds.length > 0) {
      const senderUser = await User.findById(userObjectId).select('username');
      const senderUsername = senderUser?.username || 'Someone';

      for (const contactUserId of contactUserIds) {
        if (userObjectId.toString() === contactUserId.toString()) {
          continue; // Skip self
        }

        const alert = await PanicAlert.create({
          incidentId: incident._id,
          fromUserId: userObjectId,
          toUserId: contactUserId,
          status: 'SENT',
          emailSent: false,
        });

        // Send email notification
        const receiverUser = await User.findById(contactUserId).select('email username');
        if (receiverUser && receiverUser.email) {
          try {
            const emailResult = await sendEmergencyEmail({
              toEmail: receiverUser.email,
              senderUsername,
              senderUserId: userId,
              incidentId: (incident._id as mongoose.Types.ObjectId).toString(),
            });

            if (emailResult.success) {
              notificationsSent++;
            }

            alert.emailSent = emailResult.success;
            if (emailResult.error) {
              alert.emailError = emailResult.error;
            }
            await alert.save();
          } catch (emailError: any) {
            console.error('[WalkieTalkie] Emergency email error:', emailError);
          }
        }
      }
    }

    // Save emergency message to database (use special threadId)
    const emergencyThreadId = `emergency_${userId}_${Date.now()}`;
    await WalkieTalkieMessage.create({
      threadId: emergencyThreadId,
      userId: userObjectId,
      role: 'user',
      text: transcript,
      audioUrl: `/uploads/${path.basename(req.file.path)}`,
      createdAt: new Date(),
    });

    await WalkieTalkieMessage.create({
      threadId: emergencyThreadId,
      userId: userObjectId,
      role: 'assistant',
      text: aiResponse,
      createdAt: new Date(),
    });

    console.log('[WalkieTalkie] Emergency processed - notifications sent:', notificationsSent);

    // Return response
    res.json({
      success: true,
      transcript,
      responseText: aiResponse,
      notificationsSent,
      incidentId: (incident._id as mongoose.Types.ObjectId).toString(),
    });

  } catch (error: any) {
    console.error('[WalkieTalkie] sendEmergency error:', error);
    
    // Cleanup file on error
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    
    res.status(500).json({
      error: 'Failed to process emergency',
      details: error.message || 'Unknown error',
    });
  }
};

/**
 * GET /api/wt/thread/:threadId
 * Return message history for a thread
 */
export const getThread = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userId = req.user.userId;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const threadId = req.params.threadId;

    if (!threadId) {
      res.status(400).json({ error: 'Missing threadId' });
      return;
    }

    // Get messages for this thread (only for this user)
    const messages = await WalkieTalkieMessage.find({
      threadId,
      userId: userObjectId,
    })
      .sort({ createdAt: 1 }) // Oldest first
      .lean();

    // Format messages
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      text: msg.text,
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


import { Request, Response } from 'express';
import { getAIPanicResponse, conversationStore, getBreathingDecision } from '../services/aiPanic.service';
import Post from '../models/Post';
import mongoose from 'mongoose';

export const panicChat = async (req: Request, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  
  try {
    console.log(`[AI] [${requestId}] Request received:`, {
      method: req.method,
      path: req.path,
      userId: req.user?.userId || 'none',
      hasAuth: !!req.user,
      bodyKeys: Object.keys(req.body || {}),
      messageLength: req.body?.message?.length || 0,
      historyLength: req.body?.history?.length || 0,
      conversationId: req.body?.conversationId || 'none',
    });

    if (!req.user) {
      console.error(`[AI] [${requestId}] Unauthorized - no user in request`);
      return res.status(401).json({ 
        error: 'Unauthorized',
        details: 'No user found in request. Please log in again.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error(`[AI] [${requestId}] Gemini not configured - GEMINI_API_KEY is missing`);
      return res.status(503).json({
        error: 'Gemini AI is not connected',
        code: 'GEMINI_NOT_CONFIGURED',
        details: 'Server is missing GEMINI_API_KEY. Please configure it in the server environment.',
      });
    }

    const userId = req.user.userId;
    const { message, history, conversationId, detectedLang } = req.body;
    
    // Log detected language for voice input (dev-only)
    if (detectedLang) {
      console.log('[AI] [LANGUAGE] Voice input detected, STT detectedLang:', detectedLang);
      console.log('[AI] [LANGUAGE] Transcript (first 40 chars):', message?.substring(0, 40) || '');
    }

    // Validate request body
    if (!message || typeof message !== 'string') {
      console.error(`[AI] [${requestId}] Validation error: message is required and must be a string`);
      return res.status(400).json({
        error: 'Invalid request',
        details: 'Message is required and must be a string',
      });
    }

    // Get or create conversationId
    let currentConversationId = conversationId;
    if (!currentConversationId || typeof currentConversationId !== 'string') {
      // Generate new conversationId
      currentConversationId = `conv_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      console.log('[AI] Created new conversationId:', currentConversationId);
    } else {
      console.log('[AI] Using existing conversationId:', currentConversationId);
    }

    // Load conversation history from store or use provided history
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    
    if (conversationStore.has(currentConversationId)) {
      // Load from store
      conversationHistory = conversationStore.get(currentConversationId)!;
      console.log('[AI] Loaded conversation history from store:', conversationHistory.length, 'messages');
    } else if (Array.isArray(history)) {
      // Use provided history (for backward compatibility or initial load)
      conversationHistory = history.filter(
        (msg: any) =>
          msg &&
          typeof msg === 'object' &&
          (msg.role === 'user' || msg.role === 'assistant') &&
          typeof msg.content === 'string'
      );
      console.log('[AI] Using provided history:', conversationHistory.length, 'messages');
    }

    // Add current user message to history
    if (message && message.trim()) {
      conversationHistory.push({
        role: 'user',
        content: message.trim(),
      });
    }

    // Fetch user's recent posts for context (last 10 posts, ordered by date)
    let userPosts: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> = [];
    try {
      console.log(`[AI] [${requestId}] Fetching user posts for context - userId: ${userId}`);

      let posts: any[] = [];
      if (mongoose.Types.ObjectId.isValid(userId)) {
        const oid = new mongoose.Types.ObjectId(userId);
        posts = await Post.find({ $or: [{ authorId: oid }, { authorId: userId }] })
          .sort({ createdAt: -1 })
          .limit(10)
          .select('title content tags createdAt')
          .lean();
      }
      if (posts.length === 0) {
        posts = await Post.find({ authorId: userId })
          .sort({ createdAt: -1 })
          .limit(10)
          .select('title content tags createdAt')
          .lean();
      }
      
      userPosts = posts.map(post => ({
        title: post.title,
        content: post.content,
        tags: post.tags || [],
        createdAt: post.createdAt,
      }));
      
      console.log(`[AI] [${requestId}] Fetched ${userPosts.length} user posts for context`);
    } catch (err) {
      console.error(`[AI] [${requestId}] Error fetching user posts for context:`, err);
      console.error(`[AI] [${requestId}] userId: ${userId}, error: ${err instanceof Error ? err.message : String(err)}`);
      // Continue without user context if fetch fails
      userPosts = [];
    }

    // Log recentPosts count (safe log)
    console.log('[AI] recentPosts count:', userPosts?.length || 0);

    // Get breathing decision BEFORE calling AI (deterministic, backend-controlled)
    const breathingDecision = getBreathingDecision(currentConversationId, message);
    
    // Get AI response with conversation history (always returns a string, never throws)
    // Pass detectedLang if provided (voice input with STT auto-detection)
    let messageText = await getAIPanicResponse(
      message || 'Start', 
      conversationHistory,
      { recentPosts: userPosts },
      currentConversationId,
      userId,
      detectedLang // Pass detected language from STT (if voice input)
    );
    
    // Log final reply language (dev-only)
    if (detectedLang) {
      console.log('[AI] [LANGUAGE] Final reply language:', detectedLang);
    }

    // Append breathing offer text if needed (deterministic, backend-controlled)
    // Use fixed question text (NOT model-generated) to ensure completeness
    if (breathingDecision.shouldOfferBreathing) {
      // Ensure AI reply ends with complete sentence (no trailing fragments)
      const trimmedText = messageText.trim();
      // Check if last sentence is incomplete
      if (!trimmedText.match(/[.!?]$/)) {
        // Remove any trailing incomplete phrases
        const cleanedText = trimmedText.replace(/\s+(when|using|with|and|or|but)\s*\.\.?\.?$/i, '').trim();
        messageText = cleanedText + (cleanedText.match(/[.!?]$/) ? '' : '.');
      }
      // Append fixed breathing question
      messageText = messageText.trim() + '\n\nDo you want to try a breathing exercise with me right now?';
      console.log(`[AI] [${requestId}] Breathing offer appended to AI response`);
    }

    // Add AI response to conversation history (with offer text if appended)
    conversationHistory.push({
      role: 'assistant',
      content: messageText,
    });

    // Store updated conversation history
    conversationStore.set(currentConversationId, conversationHistory);
    console.log('[AI] Stored conversation history:', conversationHistory.length, 'messages total');

    // Build response with optional action
    const response: any = {
      success: true,
      message: messageText,
      conversationId: currentConversationId
    };
    
    // Add breathing action ONLY if decision says to trigger
    if (breathingDecision.shouldTriggerBreathingAction) {
      response.action = {
        type: 'BREATHING_EXERCISE',
        payload: {
          pattern: '4-4-6',
          cycles: 6
        }
      };
      console.log(`[AI] [${requestId}] Breathing exercise action triggered - user requested/consented`);
    }

    // Return success with message and conversationId
    console.log(`[AI] [${requestId}] Success - returning response:`, {
      messageLength: messageText.length,
      conversationId: currentConversationId,
      historyLength: conversationHistory.length,
      hasAction: !!response.action,
    });

    return res.status(200).json(response);
  } catch (error: any) {
    const msg = error?.message || 'Unknown error';
    console.error(`[AI] [${requestId}] ERROR in panicChat controller:`, {
      message: msg,
      stack: error.stack,
      name: error.name,
      code: error.code,
    });

    // Detect Gemini quota / rate-limit / availability errors → return 503 so UI can show clear message
    const isGeminiQuota =
      msg.includes('429') ||
      msg.includes('Too Many Requests') ||
      msg.includes('quota') ||
      msg.includes('rate-limit') ||
      msg.includes('rate limit') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('quota exceeded');
    if (isGeminiQuota) {
      return res.status(503).json({
        error: 'Gemini AI quota exceeded or temporarily unavailable.',
        code: 'GEMINI_QUOTA_EXCEEDED',
        details: 'Please try again in a few minutes or check your API quota.',
      });
    }

    // Return 500 with error details for other errors
    return res.status(500).json({
      error: msg.length > 200 ? msg.substring(0, 200) + '...' : msg,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};




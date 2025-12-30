import { Request, Response } from 'express';
import { getAIPanicResponse, conversationStore } from '../services/aiPanic.service';
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
      const posts = await Post.find({ 
        authorId: new mongoose.Types.ObjectId(userId) 
      })
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
      console.error('[AI] Error fetching user posts for context:', err);
      // Continue without user context if fetch fails
    }

    // Get AI response with conversation history (always returns a string, never throws)
    // Pass detectedLang if provided (voice input with STT auto-detection)
    const messageText = await getAIPanicResponse(
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

    // Add AI response to conversation history
    conversationHistory.push({
      role: 'assistant',
      content: messageText,
    });

    // Store updated conversation history
    conversationStore.set(currentConversationId, conversationHistory);
    console.log('[AI] Stored conversation history:', conversationHistory.length, 'messages total');

    // Return success with message and conversationId
    console.log(`[AI] [${requestId}] Success - returning response:`, {
      messageLength: messageText.length,
      conversationId: currentConversationId,
      historyLength: conversationHistory.length,
    });

    return res.status(200).json({ 
      success: true, 
      message: messageText,
      conversationId: currentConversationId
    });
  } catch (error: any) {
    console.error(`[AI] [${requestId}] ERROR in panicChat controller:`, {
      message: error.message || 'Unknown error',
      stack: error.stack,
      name: error.name,
      code: error.code,
    });
    
    // Return 500 with error details
    return res.status(500).json({
      error: error.message || 'Failed to get AI response',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};




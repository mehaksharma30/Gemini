import { Request, Response } from 'express';
import { getAIPanicResponse } from '../services/aiPanic.service';
import Post from '../models/Post';
import mongoose from 'mongoose';

export const panicChat = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;
    const { message, history } = req.body;

    // Validate history format
    const validHistory = Array.isArray(history)
      ? history.filter(
          (msg: any) =>
            msg &&
            typeof msg === 'object' &&
            (msg.role === 'user' || msg.role === 'assistant') &&
            typeof msg.content === 'string'
        )
      : [];

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

    // Get AI response with user context (always returns a string, never throws)
    const messageText = await getAIPanicResponse(
      message || 'Start', 
      validHistory,
      { recentPosts: userPosts }
    );

    // Return success with message
    return res.status(200).json({ 
      success: true, 
      message: messageText 
    });
  } catch (error: any) {
    console.error('[AI] ERROR in panicChat controller:', error.message || 'Unknown error');
    console.error('[AI] Stack:', error.stack);
    
    // Return 500 with error details
    return res.status(500).json({
      error: error.message || 'Failed to get AI response',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};




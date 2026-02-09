/**
 * Diagnostic endpoint to debug AI post visibility.
 * GET /api/ai/debug-posts (auth required)
 * Returns what posts the AI can see for the current user.
 */
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Post from '../models/Post';

export const debugPosts = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;
    const authorIdObj = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : null;

    // Query 1: Exact query used by panic chat (with read primary)
    let withReadPrimary: any[] = [];
    let withReadPrimaryError: string | null = null;
    try {
      withReadPrimary = await Post.find({ authorId: authorIdObj ?? userId })
        .read('primary')
        .sort({ createdAt: -1 })
        .limit(10)
        .select('_id title createdAt authorId')
        .lean();
    } catch (e: any) {
      withReadPrimaryError = e?.message || String(e);
    }

    // Query 2: Same query WITHOUT read('primary') - to compare
    let withoutReadPrimary: any[] = [];
    let withoutReadPrimaryError: string | null = null;
    try {
      withoutReadPrimary = await Post.find({ authorId: authorIdObj ?? userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('_id title createdAt authorId')
        .lean();
    } catch (e: any) {
      withoutReadPrimaryError = e?.message || String(e);
    }

    // Query 3: Raw count for this user
    let totalCount = 0;
    try {
      totalCount = await Post.countDocuments({ authorId: authorIdObj ?? userId });
    } catch (e) {
      /* ignore */
    }

    // Query 4: Sample of ALL posts in DB (last 5 by createdAt) to see authorId format
    let allPostsSample: any[] = [];
    try {
      allPostsSample = await Post.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .select('_id title createdAt authorId authorName')
        .lean();
    } catch (e) {
      /* ignore */
    }

    return res.json({
      debug: true,
      userId,
      userIdType: typeof userId,
      authorIdForQuery: authorIdObj ? authorIdObj.toString() : 'used raw userId',
      withReadPrimary: {
        count: withReadPrimary.length,
        error: withReadPrimaryError,
        posts: withReadPrimary.map((p: any) => ({
          id: p._id?.toString(),
          title: p.title,
          createdAt: p.createdAt,
          authorIdStored: p.authorId?.toString?.(),
        })),
      },
      withoutReadPrimary: {
        count: withoutReadPrimary.length,
        error: withoutReadPrimaryError,
        posts: withoutReadPrimary.map((p: any) => ({
          id: p._id?.toString(),
          title: p.title,
          createdAt: p.createdAt,
          authorIdStored: p.authorId?.toString?.(),
        })),
      },
      totalPostsForUser: totalCount,
      allPostsSample: allPostsSample.map((p: any) => ({
        id: p._id?.toString(),
        title: p.title,
        createdAt: p.createdAt,
        authorId: p.authorId?.toString?.(),
        authorName: p.authorName,
      })),
    });
  } catch (error: any) {
    console.error('[AI Debug] Error:', error);
    return res.status(500).json({
      error: error?.message || 'Debug failed',
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
  }
};

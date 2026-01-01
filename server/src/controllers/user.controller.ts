import { Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Post from '../models/Post';
import Comment from '../models/Comment';

export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const user = await User.findById(userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const postCount = await Post.countDocuments({ authorId: user._id });

    return res.json({
      success: true,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        tokens: user.tokens,
        xp: user.xp,
        level: user.level,
        badge: user.badge,
        createdAt: user.createdAt,
        postCount,
      },
    });
  } catch (error: any) {
    console.error('Get user profile error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch user profile' });
  }
};

export const getUserPosts = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [posts, total] = await Promise.all([
      Post.find({ authorId: userObjectId, isPublic: true })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Post.countDocuments({ authorId: userObjectId, isPublic: true }),
    ]);

    const postIds = posts.map(post => post._id);
    const commentCounts = await Comment.aggregate([
      { $match: { postId: { $in: postIds } } },
      { $group: { _id: '$postId', count: { $sum: 1 } } }
    ]);

    const countMap = new Map(commentCounts.map(item => [item._id.toString(), item.count]));

    const postsWithCounts = posts.map(post => {
      const postObj = post.toObject();
      return {
        ...postObj,
        commentCount: countMap.get((post._id as mongoose.Types.ObjectId).toString()) || 0
      };
    });

    return res.json({
      success: true,
      data: postsWithCounts,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Get user posts error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch user posts' });
  }
};

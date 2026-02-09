import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Post from '../models/Post';
import Comment from '../models/Comment';

const normalizeTags = (tags?: string[] | string): string[] => {
  if (Array.isArray(tags)) {
    return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  }

  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  return [];
};

const parsePagination = (req: Request) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const attachCommentCounts = async (posts: any[]) => {
  const postIds = posts.map(post => post._id);

  const commentCounts = await Comment.aggregate([
    { $match: { postId: { $in: postIds } } },
    { $group: { _id: '$postId', count: { $sum: 1 } } }
  ]);

  const countMap = new Map(commentCounts.map(item => [item._id.toString(), item.count]));

  return posts.map(post => {
    const postObj = post.toObject ? post.toObject() : post;
    return {
      ...postObj,
      commentCount: countMap.get(post._id.toString()) || 0
    };
  });
};

export const getPosts = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = parsePagination(req);

    const [posts, total] = await Promise.all([
      Post.find({ isPublic: true })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Post.countDocuments({ isPublic: true }),
    ]);

    const postsWithCounts = await attachCommentCounts(posts);

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
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch posts' });
  }
};

export const getMyPosts = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { page, limit, skip } = parsePagination(req);

    const query = { authorId: new mongoose.Types.ObjectId(userId) };

    const [posts, total] = await Promise.all([
      Post.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Post.countDocuments(query),
    ]);

    const postsWithCounts = await attachCommentCounts(posts);

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
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch your posts' });
  }
};

export const getPostById = async (req: Request, res: Response) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const requesterId = req.user?.userId;
    if (!requesterId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const isOwner = post.authorId.toString() === requesterId;
    if (!post.isPublic && !isOwner) {
      return res.status(403).json({ success: false, message: 'You are not allowed to view this post' });
    }

    const [postWithCount] = await attachCommentCounts([post]);

    return res.json({ success: true, data: postWithCount });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch post' });
  }
};

export const createPost = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { title, content, tags, isPublic } = req.body;

    if (!title || !title.trim() || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Title and content are required' });
    }

    const authorId = mongoose.Types.ObjectId.isValid(req.user.userId)
      ? new mongoose.Types.ObjectId(req.user.userId)
      : req.user.userId;

    const post = await Post.create({
      title: title.trim(),
      content: content.trim(),
      tags: normalizeTags(tags),
      isPublic: typeof isPublic === 'boolean' ? isPublic : true,
      authorId,
      authorName: req.user.username,
    });

    return res.status(201).json({ success: true, data: post, message: 'Post created successfully' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to create post' });
  }
};

export const updatePost = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const isOwner = post.authorId.toString() === req.user.userId;
    if (!isOwner) {
      return res.status(403).json({ success: false, message: 'You can only update your own posts' });
    }

    const { title, content, tags, isPublic } = req.body;
    if (title !== undefined) post.title = title.trim();
    if (content !== undefined) post.content = content.trim();
    if (tags !== undefined) post.tags = normalizeTags(tags);
    if (isPublic !== undefined) post.isPublic = Boolean(isPublic);

    await post.save();

    return res.json({ success: true, data: post, message: 'Post updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update post' });
  }
};

export const deletePost = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const isOwner = post.authorId.toString() === req.user.userId;
    if (!isOwner) {
      return res.status(403).json({ success: false, message: 'You can only delete your own posts' });
    }

    await post.deleteOne();
    return res.json({
      success: true,
      data: { deleted: true },
      message: 'Post deleted successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to delete post' });
  }
};

export const likePost = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const alreadyLiked = post.likedBy.some((id) => id.toString() === userId.toString());

    if (!alreadyLiked) {
      post.likedBy.push(userId);
      post.likeCount += 1;
      await post.save();
    }

    return res.json({
      success: true,
      data: post,
      message: 'Post liked successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to like post' });
  }
};

export const unlikePost = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const userId = req.user.userId;
    const likeIndex = post.likedBy.findIndex((id) => id.toString() === userId);

    if (likeIndex !== -1) {
      post.likedBy.splice(likeIndex, 1);
      post.likeCount = Math.max(0, post.likeCount - 1);
      await post.save();
    }

    return res.json({
      success: true,
      data: post,
      message: 'Post unliked successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to unlike post' });
  }
};

import { Request, Response } from 'express';
import Post from '../models/Post';
import User from '../models/User';
import { getSearchKeywordsFromOpenAI } from '../services/openaiChat.service';

interface PostSnippet {
  postId: string;
  title: string;
  excerpt: string;
  tags: string[];
}

interface UserSearchResult {
  userId: string;
  username: string;
  xp: number;
  level: number;
  badge: 'none' | 'silver' | 'gold' | 'diamond';
  relevanceScore: number;
  posts: PostSnippet[];
}

export const searchUsersByTopic = async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, message: 'Search query is required' });
    }

    const searchQuery = query.trim();

    const keywords = await getSearchKeywordsFromOpenAI(searchQuery);

    if (keywords.length === 0) {
      return res.json({
        success: true,
        query: searchQuery,
        keywords: [],
        results: [],
      });
    }

    const regexes = keywords.map(k => new RegExp(k, 'i'));

    const posts = await Post.find({
      isPublic: true,
      $or: [
        { title: { $in: regexes } },
        { content: { $in: regexes } },
        { tags: { $in: keywords } },
      ],
    })
      .select('_id authorId authorName title content tags')
      .lean();

    if (posts.length === 0) {
      return res.json({
        success: true,
        query: searchQuery,
        keywords,
        results: [],
      });
    }

    const postsByAuthor = new Map<string, any[]>();

    posts.forEach(post => {
      const authorIdStr = post.authorId.toString();
      if (!postsByAuthor.has(authorIdStr)) {
        postsByAuthor.set(authorIdStr, []);
      }
      postsByAuthor.get(authorIdStr)!.push(post);
    });

    const authorIds = Array.from(postsByAuthor.keys());
    const users = await User.find({
      _id: { $in: authorIds },
    })
      .select('_id username xp level badge')
      .lean();

    const results: UserSearchResult[] = users.map(user => {
      const userPosts = postsByAuthor.get(user._id.toString()) || [];

      const postSnippets: PostSnippet[] = userPosts.slice(0, 5).map(post => ({
        postId: post._id.toString(),
        title: post.title,
        excerpt: post.content.substring(0, 200).trim() + (post.content.length > 200 ? '...' : ''),
        tags: post.tags || [],
      }));

      return {
        userId: user._id.toString(),
        username: user.username,
        xp: user.xp,
        level: user.level,
        badge: user.badge,
        relevanceScore: userPosts.length,
        posts: postSnippets,
      };
    });

    results.sort((a, b) => {
      if (b.xp !== a.xp) {
        return b.xp - a.xp;
      }
      return b.relevanceScore - a.relevanceScore;
    });

    return res.json({
      success: true,
      query: searchQuery,
      keywords,
      results,
    });
  } catch (error: any) {
    console.error('Search users by topic error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Search failed',
    });
  }
};

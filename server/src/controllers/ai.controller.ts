import { Request, Response } from 'express';
import Post from '../models/Post';
import { getOpenAIText } from '../services/openaiChat.service';

interface RecommendedPost {
  postId: string;
  authorId: string;
  authorName: string;
  title: string;
  excerpt: string;
  tags: string[];
}

async function findSimilarPosts(query: string): Promise<RecommendedPost[]> {
  try {

    const keywords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);

    if (keywords.length === 0) {

      const posts = await Post.find({ isPublic: true })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      return posts.map(post => ({
        postId: post._id.toString(),
        authorId: post.authorId.toString(),
        authorName: post.authorName,
        title: post.title,
        excerpt: post.content.substring(0, 200).trim() + (post.content.length > 200 ? '...' : ''),
        tags: post.tags || [],
      }));
    }

    try {
      const posts = await Post.find(
        {
          $text: { $search: keywords.join(' ') },
          isPublic: true,
        },
        {
          score: { $meta: 'textScore' },
        }
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(10)
        .lean();

      if (posts.length > 0) {
        return posts.map(post => ({
          postId: post._id.toString(),
          authorId: post.authorId.toString(),
          authorName: post.authorName,
          title: post.title,
          excerpt: post.content.substring(0, 200).trim() + (post.content.length > 200 ? '...' : ''),
          tags: post.tags || [],
        }));
      }
    } catch (textSearchError) {
      console.log('Text search not available, using regex fallback');
    }

    const regexPatterns = keywords.map(kw => new RegExp(kw, 'i'));
    const posts = await Post.find({
      isPublic: true,
      $or: [
        { title: { $in: regexPatterns } },
        { content: { $in: regexPatterns } },
        { tags: { $in: keywords } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    return posts.map(post => ({
      postId: post._id.toString(),
      authorId: post.authorId.toString(),
      authorName: post.authorName,
      title: post.title,
      excerpt: post.content.substring(0, 200).trim() + (post.content.length > 200 ? '...' : ''),
      tags: post.tags || [],
    }));
  } catch (error: any) {
    console.error('Find similar posts error:', error);
    return [];
  }
}

export const aiChat = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }

    // CRITICAL: Check for OpenAI API key - throw clear error if missing
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const error = new Error('OPENAI_API_KEY is required for AI Talk. Please configure it in your environment variables.');
      console.error('[AI Chat] ERROR:', error.message);
      return res.status(500).json({
        success: false,
        message: 'AI service is not configured. Please contact support.',
        error: error.message,
      });
    }

    const similarPosts = await findSimilarPosts(question);

    let context = '';
    if (similarPosts.length > 0) {
      context = 'Here are some posts from other MindMemos users who shared similar experiences:\n\n';
      similarPosts.forEach((post, index) => {
        const tagsStr = post.tags.length > 0 ? ` (tags: ${post.tags.map(t => '#' + t).join(' ')})` : '';
        context += `${index + 1}. "${post.title}" by ${post.authorName} – ${post.excerpt}${tagsStr}\n\n`;
      });
    } else {
      context = 'No directly similar posts found in the community yet, but I can still offer support.';
    }

    // Build prompt for OpenAI (similar to panic chat but with AI Talk system prompt)
    const systemPrompt = `You are the MindMemos AI Companion, a supportive peer support assistant for a mental health journaling app.

Your role:
- Provide empathetic, supportive responses to users sharing their mental health experiences
- Use warm, compassionate, non-clinical language
- Help users feel heard and validated
- Suggest healthy coping strategies when appropriate
- Reference the similar experiences shared by other MindMemos users when relevant

IMPORTANT SAFETY RULES:
- You are NOT a licensed mental health professional
- You CANNOT provide medical diagnosis or treatment
- You MUST NOT give advice about self-harm or harmful behavior
- Always remind users that this is peer support, not professional care
- If someone appears to be in crisis, gently encourage them to contact a professional or crisis line

Always end your responses with a gentle reminder about seeking professional help when needed.`;

    // ALWAYS use OpenAI (gpt-5-mini) - never Ollama
    const answer = await getOpenAIText(systemPrompt, [
      { role: 'user', content: `${context}User's question: ${question.trim()}` }
    ]);

    return res.json({
      success: true,
      answer,
      recommendations: similarPosts,
    });
  } catch (error: any) {
    console.error('AI chat error:', error);

    let message = 'AI service is currently unavailable';
    if (error.message.includes('OpenAI API key not configured') || error.message.includes('OPENAI_API_KEY')) {
      message = 'AI service is not configured. Please contact support.';
    }

    return res.status(500).json({
      success: false,
      message,
      error: error.message,
    });
  }
};

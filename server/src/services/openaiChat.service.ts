/**
 * Chat and search keyword helpers — delegates to aiProvider (Gemini).
 * Keeps same export names so controllers need no changes.
 */

import { generateChatReply, getSearchKeywords as getKeywordsFromProvider } from './aiProvider';

/**
 * Get AI text response (system prompt + messages).
 * Used for general chatbot (AI Talk) and search utilities.
 */
export async function getOpenAIText(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is required. Please configure it in your environment variables.');
    console.error('[AI Chat] ERROR:', error.message);
    throw error;
  }
  return generateChatReply(systemPrompt, messages);
}

/**
 * Get search keywords from user query.
 */
export async function getSearchKeywordsFromOpenAI(query: string): Promise<string[]> {
  return getKeywordsFromProvider(query);
}

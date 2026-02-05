/**
 * Single AI provider module — only place that talks to LLM (Gemini).
 * Exposes the same function shapes the rest of the app expects.
 * Env: GEMINI_API_KEY
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required. Please configure it in your environment variables.');
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Generate a chat reply from system prompt + messages (same shape as former getOpenAIText).
 * Used by ai.controller (AI Talk) and search keyword extraction.
 */
export async function generateChatReply(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const genAI = getGeminiClient();
  // Use a current Gemini model (gemini-1.5-flash is deprecated; 2.0/2.5 are current)
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: 2000,
      temperature: 0.7,
    },
  });

  if (messages.length === 0) {
    const result = await model.generateContent('Hello');
    const text = result.response.text?.()?.trim() ?? '';
    return text || "I'm here—can you say that again in one line?";
  }

  // Build history for Gemini: 'user' and 'model' (assistant)
  const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    history.push({ role, parts: [{ text: msg.content }] });
  }

  const lastMsg = messages[messages.length - 1];
  const lastContent = lastMsg.content;

  if (history.length <= 1) {
    // Single message: use generateContent
    const result = await model.generateContent(lastContent);
    const text = result.response.text?.()?.trim() ?? '';
    return text || "I'm here—can you say that again in one line?";
  }

  // Multi-turn: startChat with history (all but last), then send last message
  const chatHistory = history.slice(0, -1);
  const chat = model.startChat({ history: chatHistory });
  const result = await chat.sendMessage(lastContent);
  const response = result.response;
  const text = response.text?.()?.trim() ?? '';

  return text || "I'm here—can you say that again in one line?";
}

/**
 * Generate reply from a single full prompt string (system + history concatenated).
 * Used by aiPanic.service (panic/support chat).
 */
export async function generateFromPrompt(prompt: string): Promise<string> {
  const genAI = getGeminiClient();
  // Use a current Gemini model (gemini-1.5-flash is deprecated; 2.0/2.5 are current)
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 2000,
      temperature: 0.7,
    },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text?.()?.trim() ?? '';

  return text || "I'm here with you. Take a deep breath. You're not alone. If you need immediate support, please reach out to someone you trust or use the emergency contacts feature in this app.";
}

/**
 * Check if Gemini is configured and reachable (for status/health).
 * Returns { ok: true, model } on success, or { ok: false, error } on failure.
 */
export async function checkGeminiStatus(): Promise<{ ok: boolean; model?: string; error?: string }> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, error: 'GEMINI_API_KEY is not set' };
  }
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { maxOutputTokens: 10, temperature: 0 },
    });
    const result = await model.generateContent('Reply with exactly: OK');
    const text = result.response.text?.()?.trim() ?? '';
    if (!text) {
      return { ok: false, error: 'Empty response from Gemini', model: modelName };
    }
    return { ok: true, model: modelName };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const quotaExceeded = msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests');
    return {
      ok: false,
      error: quotaExceeded
        ? 'Gemini quota exceeded (free tier limit). Wait a few minutes or check https://ai.google.dev/gemini-api/docs/rate-limits'
        : msg.length > 200 ? msg.substring(0, 200) + '...' : msg,
      model: modelName,
    };
  }
}

/**
 * Get search keywords from user query (same shape as former getSearchKeywordsFromOpenAI).
 */
export async function getSearchKeywords(query: string): Promise<string[]> {
  const systemPrompt = `Extract 3-8 concise search keywords/phrases from the user query. Return ONLY a comma-separated list. No extra words.`;
  try {
    const response = await generateChatReply(systemPrompt, [{ role: 'user', content: query }]);
    const keywords = response
      .split(',')
      .map((kw: string) => kw.trim().toLowerCase())
      .filter((kw: string) => kw.length > 0 && kw.length < 50);
    const originalKeywords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const allKeywords = [...new Set([...keywords, ...originalKeywords])];
    return allKeywords.slice(0, 10);
  } catch (err: any) {
    console.error('[AI Provider] Search keyword extraction error:', err?.message);
    return query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  }
}

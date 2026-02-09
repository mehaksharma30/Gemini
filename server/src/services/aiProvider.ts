/**
 * Single AI provider module — only place that talks to LLM (Gemini).
 * Uses v1beta REST API directly for reliable response parsing.
 * Env: GEMINI_API_KEY, GEMINI_MODEL (optional, default gemini-2.0-flash)
 */

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

const GEMINI_V1BETA =
  'https://generativelanguage.googleapis.com/v1beta';

function getModelName(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required. Please configure it in your environment variables.');
  }
  return apiKey;
}

/**
 * Parse text from Gemini REST response.
 * Path: candidates?.[0]?.content?.parts?.[0]?.text
 */
function extractTextFromResponse(json: any): string | null {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text.trim() || null : null;
}

/**
 * Call Gemini v1beta generateContent REST API.
 * Throws with logged full JSON if response structure is unexpected.
 */
async function generateContentRest(
  prompt: string,
  options?: {
    systemInstruction?: string;
    history?: Array<{ role: 'user' | 'model'; parts: { text: string }[] }>;
    maxOutputTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  const modelName = getModelName();
  const apiKey = getApiKey();
  const url = `${GEMINI_V1BETA}/models/${modelName}:generateContent?key=${apiKey}`;

  const contents: any[] = [];
  if (options?.history?.length) {
    for (const item of options.history) {
      contents.push({ role: item.role, parts: item.parts });
    }
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: options?.maxOutputTokens ?? 2000,
      temperature: options?.temperature ?? 0.7,
    },
  };
  if (options?.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: options.systemInstruction }],
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };

  if (!res.ok) {
    const errMsg = json?.error?.message || res.statusText;
    console.error('[AI Provider] Gemini API error:', res.status, errMsg);
    throw new Error(errMsg);
  }

  const text = extractTextFromResponse(json);
  if (text != null) {
    return text;
  }

  const finishReason = json?.candidates?.[0]?.finishReason;
  const errDetail = finishReason === 'MAX_TOKENS'
    ? ' (increase maxOutputTokens; thinking models use tokens before text)'
    : '';
  console.error('[AI Provider] Empty or unexpected Gemini response. Full JSON:', JSON.stringify(json, null, 2));
  throw new Error(`Empty response from Gemini: unexpected response structure${errDetail}`);
}

/**
 * Generate a chat reply from system prompt + messages.
 * Used by ai.controller (AI Talk) and search keyword extraction.
 */
export async function generateChatReply(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const fallback = "I'm here—can you say that again in one line?";
  if (messages.length === 0) {
    const text = await generateContentRest('Hello', {
      systemInstruction: systemPrompt,
      maxOutputTokens: 2000,
      temperature: 0.7,
    });
    return text || fallback;
  }

  const history: Array<{ role: 'user' | 'model'; parts: { text: string }[] }> = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    history.push({ role, parts: [{ text: msg.content }] });
  }

  const lastMsg = messages[messages.length - 1];
  const lastContent = lastMsg.content;
  const historyForApi = history.slice(0, -1);

  const text = await generateContentRest(lastContent, {
    systemInstruction: systemPrompt,
    history: historyForApi.length ? historyForApi : undefined,
    maxOutputTokens: 2000,
    temperature: 0.7,
  });
  return text || fallback;
}

/**
 * Generate reply from a single full prompt string.
 * Used by aiPanic.service (panic/support chat).
 */
export async function generateFromPrompt(prompt: string): Promise<string> {
  const fallback =
    "I'm here with you. Take a deep breath. You're not alone. If you need immediate support, please reach out to someone you trust or use the emergency contacts feature in this app.";
  const text = await generateContentRest(prompt, {
    maxOutputTokens: 2000,
    temperature: 0.7,
  });
  return text || fallback;
}

/**
 * Check if Gemini is configured and reachable.
 * Returns { ok: true, model } on success.
 */
export async function checkGeminiStatus(): Promise<{ ok: boolean; model?: string; error?: string }> {
  const modelName = getModelName();
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, error: 'GEMINI_API_KEY is not set' };
  }
  try {
    const text = await generateContentRest('Reply with exactly: OK', {
      maxOutputTokens: 64,
      temperature: 0,
    });
    if (!text || !text.trim()) {
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
 * Get search keywords from user query.
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

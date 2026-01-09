import OpenAI from 'openai';

/**
 * Extract text from OpenAI Responses API response.
 * PRIMARY: Use response.output_text directly if present.
 * FALLBACK: Extract from response.output[?].content[?].text.
 * Always returns a string (never throws).
 */
function extractTextFromResponse(response: any): string {
  try {
    // PRIMARY STRATEGY: Check output_text first (direct string)
    if (response.output_text !== undefined && response.output_text !== null) {
      if (typeof response.output_text === 'string') {
        const trimmed = response.output_text.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    
    // FALLBACK STRATEGY: Extract from output array
    if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item && item.content) {
          // If content is an array
          if (Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem && typeof contentItem.text === 'string') {
                const trimmed = contentItem.text.trim();
                if (trimmed) {
                  return trimmed;
                }
              }
            }
          }
          // If content is an object
          else if (item.content && typeof item.content.text === 'string') {
            const trimmed = item.content.text.trim();
            if (trimmed) {
              return trimmed;
            }
          }
        }
      }
    }
    
    // Last fallback: choices format (legacy)
    if (response.choices?.[0]?.message?.content && typeof response.choices[0].message.content === 'string') {
      const trimmed = response.choices[0].message.content.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    
    return '';
  } catch (err: any) {
    console.error('[OpenAI Chat] Error extracting text from response:', err);
    return '';
  }
}

/**
 * Get OpenAI text response using Responses API.
 * Used for general chatbot (non-panic) and search utilities.
 * 
 * @param systemPrompt - System prompt for the AI
 * @param messages - Array of user/assistant messages
 * @returns Promise<string> - Always returns a string (fallback if empty)
 */
export async function getOpenAIText(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is required. Please configure it in your environment variables.');
    console.error('[OpenAI Chat] ERROR:', error.message);
    throw error;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  // Build prompt from system prompt and messages
  let prompt = `System: ${systemPrompt}\n\n`;
  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    prompt += `${roleLabel}: ${msg.content}\n\n`;
  }

  // Build request parameters
  const requestParams: any = {
    model,
    input: prompt,
    max_output_tokens: 2000,
  };

  // Add reasoning.effort="low" for gpt-5-mini to ensure text output
  if (model.includes('gpt-5')) {
    requestParams.reasoning = { effort: 'low' };
  }

  console.log('[OpenAI Chat] Request started', { 
    model, 
    max_output_tokens: 2000,
    baseURL: baseURL.replace(/\/[^\/]*$/, '/***'),
    provider: 'OpenAI'
  });

  const openai = new OpenAI({
    apiKey,
    baseURL,
  });

  try {
    // Call OpenAI Responses API with timeout
    const completion = await Promise.race([
      openai.responses.create(requestParams),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000)
      ),
    ]);

    // Extract text from response
    const text = extractTextFromResponse(completion);
    
    // Always return a string - use fallback if empty
    if (text && text.trim().length > 0) {
      return text.trim();
    }
    
    console.warn('[OpenAI Chat] Empty response, returning fallback');
    return "I'm here—can you say that again in one line?";
  } catch (error: any) {
    console.error('[OpenAI Chat] ERROR:', error.message || 'Unknown error');
    console.error('[OpenAI Chat] Stack:', error.stack);
    throw error;
  }
}

/**
 * Get search keywords from OpenAI.
 * Used for search keyword extraction (replaces Ollama).
 * 
 * @param query - User's search query
 * @returns Promise<string[]> - Array of search keywords
 */
export async function getSearchKeywordsFromOpenAI(query: string): Promise<string[]> {
  const systemPrompt = `Extract 3-8 concise search keywords/phrases from the user query. Return ONLY a comma-separated list. No extra words.`;

  try {
    const response = await getOpenAIText(systemPrompt, [
      { role: 'user', content: query }
    ]);

    // Parse comma-separated keywords
    const keywords = response
      .split(',')
      .map((kw: string) => kw.trim().toLowerCase())
      .filter((kw: string) => kw.length > 0 && kw.length < 50);

    // Also include original query words
    const originalKeywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2);

    // Combine and deduplicate
    const allKeywords = [...new Set([...keywords, ...originalKeywords])];

    // Return max 10 keywords
    return allKeywords.slice(0, 10);
  } catch (error: any) {
    console.error('[OpenAI Chat] Search keyword extraction error:', error.message);
    // Fallback: return original query words
    return query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  }
}


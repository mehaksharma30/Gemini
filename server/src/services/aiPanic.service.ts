import OpenAI from 'openai';
import { getAIProvider } from '../config/aiProvider';
import { askOllama } from './ollamaService';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are a supportive mental-health companion. You listen, validate feelings, and encourage healthy coping. You do not diagnose or provide medical treatment.

Guidelines:
- Be calm, empathetic, warm, and non-judgmental
- Use short, clear sentences (keep responses under 80-120 words)
- Ask only one gentle question at a time
- Never say "I diagnose you" or provide medical/clinical advice
- Never suggest medications or treatments
- Focus on the present moment and immediate coping strategies
- Return only plain text, no JSON.

IMPORTANT RULES ABOUT BREATHING EXERCISES:
- DO NOT repeatedly mention breathing exercises
- DO NOT suggest breathing exercises unless the user explicitly asks
- If you think a breathing exercise might help, ASK FIRST: "Would you like to try a simple breathing exercise together?" and wait for their response
- Only proceed with breathing instructions if they say yes

PERSONALIZATION:
- If you have access to the user's recent journal entries/posts, reference them naturally
- Ask how they're feeling and what specific emotions or thoughts they're experiencing
- If their current feelings match patterns from their past posts, acknowledge this: "I notice you've been feeling [emotion] lately based on your recent posts. Is this similar to what you're experiencing now?"
- If they've posted about similar feelings before, acknowledge it and ask if anything has changed or if it feels different this time
- Use their journal history to understand their emotional patterns and provide personalized support

If the user sounds distressed or expresses panic/crisis language:
- Respond calmly and validate their feelings
- Ask what they're feeling specifically
- Ask if they want to try a breathing exercise (don't just suggest it)
- Suggest using the app's Alert buttons to notify their emergency contacts if appropriate
- Keep the response supportive and non-alarming

If self-harm intent or immediate danger is detected:
- Provide a brief, caring response encouraging them to contact emergency services (911/999) immediately
- Suggest reaching out to a trusted friend, family member, or emergency contact
- Mention they can use the app's Alert buttons to notify their emergency contacts

Remember: You are here to listen, validate feelings, and offer gentle support. You are not a replacement for professional mental health care.`;

const FALLBACK_MESSAGE = "I'm here with you. Take a deep breath. You're not alone. If you need immediate support, please reach out to someone you trust or use the emergency contacts feature in this app.";

/**
 * Safely extract text from OpenAI Responses API response.
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
          console.log('[AI] Extracted text from output_text:', trimmed.substring(0, 100) + '...');
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
                  console.log('[AI] Extracted text from output[].content[].text:', trimmed.substring(0, 100) + '...');
                  return trimmed;
                }
              }
            }
          }
          // If content is an object
          else if (item.content && typeof item.content.text === 'string') {
            const trimmed = item.content.text.trim();
            if (trimmed) {
              console.log('[AI] Extracted text from output[].content.text:', trimmed.substring(0, 100) + '...');
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
        console.log('[AI] Extracted text from choices[0].message.content');
        return trimmed;
      }
    }
    
    console.warn('[AI] No text found in response structure');
    return '';
  } catch (err: any) {
    console.error('[AI] Error extracting text from response:', err);
    console.error('[AI] Stack:', err?.stack);
    return '';
  }
}

/**
 * Get AI response using OpenAI Responses API with retry logic for incomplete responses.
 * Throws error if API call fails after retries (caller should handle).
 */
export async function getAIResponse(prompt: string, retryCount: number = 0): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OpenAI API key not configured');
    console.error('[AI] ERROR:', error.message);
    console.error('[AI] Stack:', error.stack);
    throw error;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  // Determine max_output_tokens: higher on retry, or based on model
  const isRetry = retryCount > 0;
  const maxOutputTokens = isRetry ? 2000 : (model.includes('gpt-5') ? 1000 : 800);
  
  // Build request parameters
  const requestParams: any = {
    model,
    input: prompt,
    max_output_tokens: maxOutputTokens,
  };

  // Add reasoning.effort="low" for gpt-5-mini to ensure text output
  if (model.includes('gpt-5')) {
    requestParams.reasoning = { effort: 'low' };
  }

  console.log('[AI] Request started', { 
    model, 
    max_output_tokens: maxOutputTokens,
    retry: isRetry,
    baseURL: baseURL.replace(/\/[^\/]*$/, '/***') 
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

    console.log('[AI] Raw response:', JSON.stringify(completion, null, 2));

    // Extract text from response (PRIMARY: output_text, FALLBACK: output[].content[].text)
    const text = extractTextFromResponse(completion);
    
    // If we have text, return it immediately (even if response is incomplete)
    if (text) {
      const response = completion as any;
      const isIncomplete = response.status === 'incomplete';
      if (isIncomplete) {
        console.log('[AI] Response incomplete but returning extracted text');
      }
      return text;
    }
    
    // Check if response is incomplete due to max_output_tokens (for retry logic)
    const response = completion as any;
    const isIncomplete = response.status === 'incomplete';
    const incompleteReason = response.incomplete_details?.reason;
    const isMaxTokensIssue = incompleteReason === 'max_output_tokens' || incompleteReason === 'max_tokens';
    
    // If incomplete due to max_output_tokens and no text extracted, retry once with higher limit
    if (isIncomplete && isMaxTokensIssue && retryCount === 0) {
      console.log('[AI] Response incomplete due to max_output_tokens, retrying with higher limit...');
      return await getAIResponse(prompt, 1);
    }
    
    // If still no text after retry, return fallback message (don't throw - always return string)
    console.warn('[AI] No text extracted, returning fallback message');
    return FALLBACK_MESSAGE;
  } catch (error: any) {
    console.error('[AI] ERROR:', error.message || 'Unknown error');
    console.error('[AI] Stack:', error.stack);
    throw error;
  }
}

/**
 * Get AI panic response using Ollama.
 * Throws error if API call fails (caller should handle).
 */
async function getAIPanicResponseOllama(
  message: string,
  history: ChatMessage[] = [],
  userContext?: { recentPosts?: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> }
): Promise<string> {
  // Build context from conversation history
  let context = '';
  if (history.length > 0) {
    context = 'Previous conversation:\n';
    for (const msg of history) {
      const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
      context += `${roleLabel}: ${msg.content}\n`;
    }
    context += '\n';
  }

  // Add user's journal context if available
  if (userContext?.recentPosts && userContext.recentPosts.length > 0) {
    context += 'User\'s Recent Journal Entries (for context):\n';
    userContext.recentPosts.slice(0, 5).forEach((post, idx) => {
      const date = new Date(post.createdAt).toLocaleDateString();
      context += `${idx + 1}. [${date}] ${post.title}: ${post.content.substring(0, 200)}${post.content.length > 200 ? '...' : ''}\n`;
    });
    context += '\n';
  }

  // Build prompt with system instructions
  const prompt = `${SYSTEM_PROMPT}\n\n${context}Current message: ${message || 'Start'}`;

  return await askOllama(prompt, context || 'No previous context');
}

/**
 * Get AI panic response with conversation history and user context.
 * Uses the active provider (OpenAI or Ollama) based on configuration.
 * Throws error if API call fails (caller should handle).
 */
export async function getAIPanicResponse(
  message: string,
  history: ChatMessage[] = [],
  userContext?: { recentPosts?: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> }
): Promise<string> {
  const provider = getAIProvider();

  if (provider === 'ollama') {
    return await getAIPanicResponseOllama(message, history, userContext);
  }

  // Default to OpenAI
  // Build input string from system prompt and conversation history
  let inputText = `System: ${SYSTEM_PROMPT}\n\n`;
  
  // Add user's journal context if available
  if (userContext?.recentPosts && userContext.recentPosts.length > 0) {
    inputText += `User's Recent Journal Entries (for context only - reference naturally if relevant):\n`;
    userContext.recentPosts.slice(0, 5).forEach((post, idx) => {
      const date = new Date(post.createdAt).toLocaleDateString();
      inputText += `${idx + 1}. [${date}] ${post.title}: ${post.content.substring(0, 200)}${post.content.length > 200 ? '...' : ''}\n`;
      if (post.tags.length > 0) {
        inputText += `   Tags: ${post.tags.join(', ')}\n`;
      }
    });
    inputText += `\nUse this context to understand patterns in their feelings. Ask how they're feeling now and if it's similar to what they've been experiencing lately.\n\n`;
  }
  
  // Add conversation history
  for (const msg of history) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    inputText += `${roleLabel}: ${msg.content}\n\n`;
  }
  
  // Add current user message
  inputText += `User: ${message || 'Start'}`;

  return await getAIResponse(inputText);
}


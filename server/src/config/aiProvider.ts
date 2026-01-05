/**
 * AI Provider Configuration
 * Determines which AI provider to use (OpenAI or Ollama)
 */

export type AIProvider = 'openai' | 'ollama';

/**
 * Determine the active AI provider based on environment variables.
 * 
 * Rules:
 * 1. If OPENAI_API_KEY is set, use OpenAI by default
 * 2. Only use Ollama if AI_PROVIDER=ollama OR USE_OLLAMA=true explicitly
 * 
 * @returns The active AI provider
 */
export function getAIProvider(): AIProvider {
  const explicitProvider = process.env.AI_PROVIDER?.toLowerCase();
  const useOllama = process.env.USE_OLLAMA === 'true';
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

  // Explicit override to use Ollama
  if (explicitProvider === 'ollama' || useOllama) {
    return 'ollama';
  }

  // Default to OpenAI if API key is set
  if (hasOpenAIKey) {
    return 'openai';
  }

  // Fallback to Ollama if no OpenAI key (for backward compatibility)
  return 'ollama';
}

/**
 * Get the active AI provider and log it.
 * Call this at server startup.
 */
export function initializeAIProvider(): AIProvider {
  const provider = getAIProvider();
  console.log(`AI Provider: ${provider}`);
  return provider;
}




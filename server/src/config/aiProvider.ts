/**
 * AI Provider Configuration
 * Now uses Gemini (Google Generative AI) exclusively
 */

export type AIProvider = 'gemini';

/**
 * Get the active AI provider (always Gemini now).
 * 
 * @returns The active AI provider
 */
export function getAIProvider(): AIProvider {
  return 'gemini';
}

/**
 * Get the active AI provider and log it.
 * Call this at server startup.
 */
export function initializeAIProvider(): AIProvider {
  const provider = getAIProvider();
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  console.log(`AI Provider: ${provider}`);
  console.log(`Using Gemini model: ${modelName}`);
  if (!hasGeminiKey) {
    console.warn('[AI Provider] GEMINI_API_KEY not set. AI features will fail.');
  }
  return provider;
}





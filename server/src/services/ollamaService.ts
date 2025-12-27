import axios from 'axios';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// Only log Ollama configuration if explicitly using Ollama (AI_PROVIDER=ollama or USE_OLLAMA=true)
const explicitOllama = process.env.AI_PROVIDER?.toLowerCase() === 'ollama' || process.env.USE_OLLAMA === 'true';
if (explicitOllama) {
  console.log('Ollama Configuration:');
  console.log('  Base URL:', OLLAMA_BASE_URL);
  console.log('  Model:', OLLAMA_MODEL);
}

const SYSTEM_PROMPT = `You are the MindMemos AI Companion, a supportive peer support assistant for a mental health journaling app.

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

export async function askOllama(prompt: string, context: string): Promise<string> {
  try {
    console.log(`[Ollama] Requesting response for model: ${OLLAMA_MODEL}`);
    console.log(`[Ollama] Prompt length: ${prompt.length}, Context length: ${context.length}`);

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      {
        model: OLLAMA_MODEL,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `Context from MindMemos community:\n${context}\n\nUser's question: ${prompt}`,
          },
        ],
        stream: false,
      },
      {
        timeout: 60000,
      }
    );

    console.log('[Ollama] Response received:', response.data?.message?.content ? 'Success' : 'Invalid format');

    if (response.data?.message?.content) {
      return response.data.message.content;
    }

    throw new Error('Invalid response from Ollama - no message content');
  } catch (error: any) {
    console.error('[Ollama] API error:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      status: error.response?.status,
    });

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new Error('Ollama server is not running. Please start Ollama and try again.');
    }

    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      throw new Error('Ollama request timed out. The model may be loading or the request is too complex.');
    }

    if (error.response?.status === 404) {
      throw new Error(`Model "${OLLAMA_MODEL}" not found. Please ensure the model is installed in Ollama.`);
    }

    throw new Error(error.message || 'Failed to get AI response from Ollama');
  }
}

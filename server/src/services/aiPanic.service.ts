import OpenAI from 'openai';
import { getAIProvider } from '../config/aiProvider';
import { askOllama } from './ollamaService';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// In-memory conversation storage: Map<conversationId, ChatMessage[]>
export const conversationStore = new Map<string, ChatMessage[]>();

// Track explicit history references per conversation: Map<conversationId, boolean>
const explicitHistoryReferenceUsed = new Map<string, boolean>();

// Track last 2 suggestions per conversation: Map<conversationId, string[]>
const conversationSuggestions = new Map<string, string[]>();

// Track if advice was given in last assistant message: Map<conversationId, boolean>
const lastMessageHadAdvice = new Map<string, boolean>();

// Track if user refused advice: Map<conversationId, boolean>
const userRefusedAdviceMap = new Map<string, boolean>();

// Track if user has expressed distress (for LISTEN FIRST rule): Map<conversationId, boolean>
const userExpressedDistressMap = new Map<string, boolean>();

// Track acknowledged emotional events per conversation: Map<conversationId, Set<string>>
const acknowledgedEvents = new Map<string, Set<string>>();

// User style profile for soft learning: Map<userId, UserStyleProfile>
interface UserStyleProfile {
  preferredResponseLength: 'short' | 'medium' | 'long'; // Based on user's message length
  adviceTolerance: 'low' | 'medium' | 'high'; // Based on acceptance/rejection
  questionTolerance: 'low' | 'medium' | 'high'; // Based on engagement
  emotionalOpenness: 'low' | 'medium' | 'high'; // Based on sharing depth
  detectedLanguage: 'english' | 'hindi' | 'hinglish' | 'mixed'; // User's language
  messageCount: number; // Track for gradual learning
}

const userStyleProfiles = new Map<string, UserStyleProfile>();

const SYSTEM_PROMPT = `You are a warm, caring human friend inside a mental health app.
You are ONE real person talking naturally, not a therapist, not a bot, not a scripted responder.
You UNDERSTAND the user's message and respond meaningfully, not repeat or paraphrase their words.

────────────────────────
1) LANGUAGE MIRRORING (VERY IMPORTANT)
────────────────────────
- Detect the user's language and style automatically.
- Respond in the SAME language or mix the user uses:
  - English → English
  - Hindi → Hindi
  - Hinglish / mixed → Hinglish
- Do NOT force formal language.
- Match the user's casual tone, slang, and pacing.
- Never explain language choice to the user.
- If user writes in Hindi/Hinglish, respond naturally in that language.

────────────────────────
2) HUMAN FRIEND BEHAVIOR
────────────────────────
- React first, then respond.
- Sound instinctive, not polished.
- Speak like a close friend sitting with the user.

Human rules:
- Sometimes short (1-2 sentences).
- Sometimes 3–4 sentences.
- Sometimes quiet (just presence).
- No fixed templates.
- Match the user's energy and depth naturally.

────────────────────────
3) EVENT-LEVEL MEMORY
────────────────────────
- Detect major emotional events (cheating, breakup, loss, self-harm).
- React emotionally ONLY ONCE per event.
- Store acknowledged events.
- On repeats, do NOT re-react — move forward.
- After event is acknowledged, switch to:
  a) grounding / stabilizing
  b) reflective clarification
  c) practical guidance (if user asks)
  d) emotional support without restating the event
- When user asks "what should I do" about an already acknowledged event:
  - Do NOT restate how painful it is.
  - Respond with clarity, structure, gentle next steps.
- Do not reuse metaphors or emotional descriptions for the same event across turns.
- Style: Human, forward-moving, grounded. Like a friend who has already said "this sucks" and is now helping you stand back up.

UNDERSTANDING OVER MIRRORING (CRITICAL):
- You must NOT repeat or paraphrase the user's emotional words.
- You must infer the meaning and respond in your own natural language.
- Example:
  User: "I'm so depressed and crying a lot"
  ❌ "You're depressed and crying"
  ✅ "Everything feels too heavy to hold right now."
- Understand what they're really saying, then respond with your own words.

────────────────────────
7) PERSONALIZATION (SOFT LEARNING)
────────────────────────
Maintain a hidden per-user profile:
- preferred_response_length (adapt to user's message length)
- advice_tolerance (adapt based on acceptance/rejection)
- question_tolerance (adapt based on engagement)
- emotional_openness (adapt based on sharing depth)

Update gradually based on:
- message length
- acceptance/rejection of advice
- engagement level

Do NOT say "I noticed…"
Do NOT expose memory.
Just adapt quietly.

Use user-specific context (posts/chats/check-ins) silently:
- Reflect relevant patterns or coping strategies *without calling it out as history*.
- Reference history explicitly ONLY when user asks ("do you remember?").
- If user has little/no history: still be warm, human, and helpful.

────────────────────────
4) ADVICE TIMING (BALANCED)
────────────────────────
- Advice is NOT default.
- Advice is allowed ONLY when:
  a) user asks what to do
  b) user feels stuck
  c) user accepts help
- One suggestion max.
- If user refuses, stop advising.
- Do NOT give advice in the first reply after distress is expressed.
- At least one response of presence must come before any suggestion.

────────────────────────
5) CRYING / OVERWHELM MODE
────────────────────────
- Prioritize presence.
- No action suggestions unless asked.
- 1–2 sentences max.
- No questions unless user initiates.
- Just be there, quietly.

────────────────────────
6) SELF-HARM RESPONSE STYLE
────────────────────────
- Calm, protective, human.
- No policy voice.
- No emergency escalation on first mention.
- Reassure presence and encourage talking.
- Escalate only if intent repeats or becomes imminent.
- Example tone:
  "I hear how bad this feels. I'm here with you, and I don't want anything to happen to you.
   Let's slow this moment down together. Talk to me — what's making it feel unbearable?"

────────────────────────
8) NO REPETITION GUARDS
────────────────────────
- Never repeat:
  greetings
  reassurance phrases
  emotional metaphors
- If overlap >25% with previous assistant reply → rewrite shorter and simpler.
- Each reply must add something new.

────────────────────────
9) STYLE CONSTRAINTS
────────────────────────
- Warm
- Imperfect
- Human
- Like a real friend, not a guidebook
- React first, then respond
- Sound instinctive, not polished
- Match user's energy and depth
- No fixed templates
- No therapy/policy voice
- Simple language

BREATHING/GROUNDING RULES:
- Only mention breathing/grounding if:
  a) The user explicitly asks for it, OR
  b) The user reports acute panic symptoms (can't breathe, chest tightness, dizziness, hyperventilating)
- Even then, keep it to ONE short line maximum.

CRITICAL RULES - NEVER DO THESE:
- NEVER use the phrase "your call" or "it's your call".
- NEVER offer breathing/grounding as a default option in every message.
- NEVER repeat the same sentence structure from your previous message.
- NEVER use template phrases.
- NEVER explain language choice to the user.

Safety rules:
- Do not diagnose or provide medical/clinical advice
- Never suggest medications or treatments
- Return only plain text, no JSON.`;

const FALLBACK_MESSAGE = "I'm here with you. Take a deep breath. You're not alone. If you need immediate support, please reach out to someone you trust or use the emergency contacts feature in this app.";

/**
 * Generate a short personal context summary (1-3 bullet points) from user's posts.
 * Only includes the most relevant items, kept subtle and stable.
 */
function generatePersonalContextSummary(
  recentPosts: Array<{ title: string; content: string; tags: string[]; createdAt: Date }>
): string {
  if (!recentPosts || recentPosts.length === 0) {
    return ''; // No history - AI will default to supportive friend mode
  }

  const summaryPoints: string[] = [];
  
  // Extract most common emotions/tags from recent posts
  const emotionCounts = new Map<string, number>();
  recentPosts.forEach(post => {
    if (post.tags && Array.isArray(post.tags)) {
      post.tags.forEach(tag => {
        emotionCounts.set(tag, (emotionCounts.get(tag) || 0) + 1);
      });
    }
  });
  
  // Get top 2-3 most frequent emotions
  const topEmotions = Array.from(emotionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emotion]) => emotion);
  
  if (topEmotions.length > 0) {
    summaryPoints.push(`Recent patterns: ${topEmotions.join(', ')}`);
  }
  
  // Extract coping strategies mentioned in posts (simple keyword detection)
  const copingKeywords = ['music', 'walk', 'breathing', 'meditation', 'exercise', 'friend', 'talk', 'journal'];
  const mentionedCoping: string[] = [];
  recentPosts.forEach(post => {
    const content = (post.content || '').toLowerCase();
    copingKeywords.forEach(keyword => {
      if (content.includes(keyword) && !mentionedCoping.includes(keyword)) {
        mentionedCoping.push(keyword);
      }
    });
  });
  
  if (mentionedCoping.length > 0 && mentionedCoping.length <= 2) {
    summaryPoints.push(`Helpful strategies: ${mentionedCoping.join(', ')}`);
  }
  
  // Limit to 2-3 points max
  const finalSummary = summaryPoints.slice(0, 2).join('\n');
  
  return finalSummary;
}

/**
 * Detect if user is asking for help, feels stuck, or accepts help.
 */
function userWantsAdvice(userMessage: string): boolean {
  if (!userMessage || typeof userMessage !== 'string') {
    return false;
  }

  const lowerMessage = userMessage.toLowerCase();
  
  // User asks for help
  const askingForHelp = [
    'what should i do',
    'what can i do',
    'help me',
    'what do i do',
    'i need help',
    'can you help',
    'how do i',
    'what would you do',
    'tell me what to do',
    'give me advice',
    'any suggestions',
    'any ideas'
  ];
  
  // User feels stuck/overwhelmed and wants relief
  const feelsStuck = [
    'i don\'t know what to do',
    'i\'m stuck',
    'i need something',
    'i don\'t know how',
    'nothing helps',
    'i can\'t handle',
    'i need relief',
    'i need to calm',
    'i need to feel better',
    'what else can i try'
  ];
  
  // User accepts help
  const acceptsHelp = [
    'maybe',
    'okay',
    'sure',
    'yes',
    'ok',
    'alright',
    'i guess',
    'why not',
    'that sounds good',
    'that might help'
  ];
  
  return askingForHelp.some(phrase => lowerMessage.includes(phrase)) ||
         feelsStuck.some(phrase => lowerMessage.includes(phrase)) ||
         acceptsHelp.some(phrase => lowerMessage.includes(phrase));
}

/**
 * Extract the event type from user message (for event-level memory).
 * Returns the event category if detected, null otherwise.
 */
function extractEventType(userMessage: string): string | null {
  if (!userMessage || typeof userMessage !== 'string') {
    return null;
  }

  const lowerMessage = userMessage.toLowerCase();
  
  // Map emotional events to event types
  const eventMap: { [key: string]: string } = {
    'cheated': 'cheating',
    'cheating': 'cheating',
    'betrayed': 'betrayal',
    'betrayal': 'betrayal',
    'broke up': 'breakup',
    'breakup': 'breakup',
    'dumped': 'breakup',
    'left me': 'breakup',
    'ended it': 'breakup',
    'divorce': 'breakup',
    'divorced': 'breakup',
    'died': 'loss',
    'death': 'loss',
    'passed away': 'loss',
    'lost': 'loss',
    'rejected': 'rejection',
    'rejection': 'rejection',
    'fired': 'job_loss',
    'laid off': 'job_loss',
    'abandoned': 'abandonment',
    'abandonment': 'abandonment',
    'lied to me': 'betrayal',
    'lied about': 'betrayal',
    'stole': 'betrayal',
    'stolen from': 'betrayal',
    'hurt me': 'betrayal',
    'hurt by': 'betrayal'
  };
  
  // Check for each event keyword
  for (const [keyword, eventType] of Object.entries(eventMap)) {
    if (lowerMessage.includes(keyword)) {
      return eventType;
    }
  }
  
  return null;
}

/**
 * Detect if user shared a major emotional disclosure (betrayal, breakup, cheating, loss).
 * These require emotional reaction FIRST, no questions in same message.
 */
function detectMajorEmotionalDisclosure(userMessage: string): boolean {
  return extractEventType(userMessage) !== null;
}

/**
 * Detect user's language (English, Hindi, Hinglish).
 */
function detectUserLanguage(userMessage: string): 'english' | 'hindi' | 'hinglish' | 'mixed' {
  if (!userMessage || typeof userMessage !== 'string') {
    return 'english';
  }

  // Hindi characters (Devanagari script)
  const hindiPattern = /[\u0900-\u097F]/;
  // Common Hindi words in English script
  const hinglishWords = ['hai', 'ho', 'hain', 'ka', 'ki', 'ko', 'se', 'mein', 'par', 'aur', 'ya', 'nahi', 'nahi', 'kya', 'kyun', 'kaise', 'kab', 'kahan', 'kisne', 'kisko', 'kiski'];
  
  const hasHindiScript = hindiPattern.test(userMessage);
  const lowerMessage = userMessage.toLowerCase();
  const hasHinglishWords = hinglishWords.some(word => lowerMessage.includes(word));
  
  if (hasHindiScript) {
    // Check if mixed with English
    const englishWords = lowerMessage.match(/\b[a-z]+\b/g) || [];
    if (englishWords.length > 0) {
      return 'hinglish';
    }
    return 'hindi';
  } else if (hasHinglishWords) {
    return 'hinglish';
  }
  
  return 'english';
}

/**
 * Detect if user is crying or overwhelmed.
 */
function detectCryingOrOverwhelm(userMessage: string): boolean {
  if (!userMessage || typeof userMessage !== 'string') {
    return false;
  }

  const lowerMessage = userMessage.toLowerCase();
  const overwhelmIndicators = [
    'crying',
    'sobbing',
    'can\'t stop crying',
    'crying a lot',
    'overwhelmed',
    'too much',
    'can\'t handle',
    'breaking down',
    'falling apart',
    'losing it',
    'completely overwhelmed',
    'drowning',
    'suffocating'
  ];
  
  return overwhelmIndicators.some(indicator => lowerMessage.includes(indicator));
}

/**
 * Get or initialize user style profile.
 */
function getUserStyleProfile(userId: string): UserStyleProfile {
  if (!userStyleProfiles.has(userId)) {
    userStyleProfiles.set(userId, {
      preferredResponseLength: 'medium',
      adviceTolerance: 'medium',
      questionTolerance: 'medium',
      emotionalOpenness: 'medium',
      detectedLanguage: 'english',
      messageCount: 0
    });
  }
  return userStyleProfiles.get(userId)!;
}

/**
 * Update user style profile based on current interaction.
 */
function updateUserStyleProfile(
  userId: string,
  userMessage: string,
  userMessageLength: number,
  adviceAccepted: boolean | null,
  questionEngagement: boolean
): void {
  const profile = getUserStyleProfile(userId);
  
  // Update message count
  profile.messageCount++;
  
  // Update language detection
  const detectedLang = detectUserLanguage(userMessage);
  if (profile.messageCount <= 3 || detectedLang !== 'english') {
    profile.detectedLanguage = detectedLang;
  }
  
  // Update preferred response length (gradual learning)
  if (profile.messageCount > 5) {
    if (userMessageLength < 20) {
      // User sends short messages - prefer shorter responses
      if (profile.preferredResponseLength === 'long') {
        profile.preferredResponseLength = 'medium';
      } else if (profile.preferredResponseLength === 'medium') {
        profile.preferredResponseLength = 'short';
      }
    } else if (userMessageLength > 50) {
      // User sends long messages - allow longer responses
      if (profile.preferredResponseLength === 'short') {
        profile.preferredResponseLength = 'medium';
      } else if (profile.preferredResponseLength === 'medium') {
        profile.preferredResponseLength = 'long';
      }
    }
  }
  
  // Update advice tolerance
  if (adviceAccepted !== null && profile.messageCount > 3) {
    if (adviceAccepted) {
      // User accepted advice - increase tolerance
      if (profile.adviceTolerance === 'low') {
        profile.adviceTolerance = 'medium';
      } else if (profile.adviceTolerance === 'medium') {
        profile.adviceTolerance = 'high';
      }
    } else {
      // User refused advice - decrease tolerance
      if (profile.adviceTolerance === 'high') {
        profile.adviceTolerance = 'medium';
      } else if (profile.adviceTolerance === 'medium') {
        profile.adviceTolerance = 'low';
      }
    }
  }
  
  // Update question tolerance based on engagement
  if (questionEngagement && profile.messageCount > 3) {
    if (profile.questionTolerance === 'low') {
      profile.questionTolerance = 'medium';
    } else if (profile.questionTolerance === 'medium') {
      profile.questionTolerance = 'high';
    }
  }
  
  // Update emotional openness based on message depth
  if (userMessageLength > 30 && profile.messageCount > 3) {
    if (profile.emotionalOpenness === 'low') {
      profile.emotionalOpenness = 'medium';
    } else if (profile.emotionalOpenness === 'medium') {
      profile.emotionalOpenness = 'high';
    }
  }
  
  console.log('[AI] Updated user style profile:', userId, profile);
}

/**
 * Check if an event type was already acknowledged in this conversation.
 */
function isEventAlreadyAcknowledged(conversationId: string | undefined, eventType: string | null): boolean {
  if (!conversationId || !eventType) {
    return false;
  }
  
  const events = acknowledgedEvents.get(conversationId);
  return events ? events.has(eventType) : false;
}

/**
 * Mark an event as acknowledged in this conversation.
 */
function markEventAsAcknowledged(conversationId: string | undefined, eventType: string | null): void {
  if (!conversationId || !eventType) {
    return;
  }
  
  if (!acknowledgedEvents.has(conversationId)) {
    acknowledgedEvents.set(conversationId, new Set());
  }
  
  acknowledgedEvents.get(conversationId)!.add(eventType);
  console.log('[AI] Event acknowledged:', eventType, 'for conversation:', conversationId);
}

/**
 * Generate response for already-acknowledged event (no emotional reaction repetition).
 */
function generatePostAcknowledgmentResponse(eventType: string | null, userAsksWhatToDo: boolean): string {
  if (userAsksWhatToDo) {
    // User asks what to do - provide clarity and structure
    const guidanceResponses = [
      "Right now, you don't have to decide everything. The first step is just protecting yourself emotionally.",
      "You don't need to figure it all out at once. Let's start with what you need right now.",
      "The most important thing right now is taking care of yourself. What feels most urgent?",
      "Let's break this down. What's the one thing that would help you feel a bit more stable right now?",
      "You don't have to solve everything today. What's one small step that would help?"
    ];
    const hash = eventType ? eventType.length : 0;
    return guidanceResponses[hash % guidanceResponses.length];
  } else {
    // User mentions event again - provide grounding/stabilizing support
    const groundingResponses = [
      "I'm here with you.",
      "How are you doing right now?",
      "What's going through your mind?",
      "Tell me what you need right now.",
      "I'm staying with you through this."
    ];
    const hash = eventType ? eventType.length : 0;
    return groundingResponses[hash % groundingResponses.length];
  }
}

/**
 * Detect if response contains questions.
 */
function responseContainsQuestion(response: string): boolean {
  if (!response || typeof response !== 'string') {
    return false;
  }

  // Check for question marks
  if (response.includes('?')) {
    return true;
  }
  
  // Check for question patterns
  const questionPatterns = [
    /how (are|do|did|will|can|would)/i,
    /what (are|do|did|will|can|would|is|was)/i,
    /when (are|do|did|will|can|would)/i,
    /where (are|do|did|will|can|would)/i,
    /why (are|do|did|will|can|would)/i,
    /would you/i,
    /could you/i,
    /can you/i,
    /do you/i,
    /are you/i,
    /tell me/i
  ];
  
  return questionPatterns.some(pattern => pattern.test(response));
}

/**
 * Remove questions from response (for reaction-first rule).
 */
function removeQuestionsFromResponse(response: string): string {
  if (!response || typeof response !== 'string') {
    return response;
  }

  let cleaned = response;
  
  // Split by sentences
  const sentences = cleaned.split(/([.!?]+)/);
  const cleanedSentences: string[] = [];
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    // Skip sentences with question marks or question patterns
    if (sentence && !sentence.includes('?') && !responseContainsQuestion(sentence)) {
      cleanedSentences.push(sentence);
    }
  }
  
  // Rejoin sentences
  cleaned = cleanedSentences.join(' ').trim();
  
  // If response is now empty or too short, use a pure reaction
  if (cleaned.length < 10) {
    const pureReactions = [
      "That hurts in a really deep way.",
      "I can't imagine how that feels.",
      "That's devastating.",
      "That must be so painful.",
      "I'm so sorry that happened.",
      "That's heartbreaking."
    ];
    const hash = response.length % pureReactions.length;
    cleaned = pureReactions[hash];
  }
  
  return cleaned;
}

/**
 * Detect if user refused advice.
 */
function detectUserRefusedAdvice(userMessage: string): boolean {
  if (!userMessage || typeof userMessage !== 'string') {
    return false;
  }

  const lowerMessage = userMessage.toLowerCase();
  const refusalPhrases = [
    'no',
    'no thanks',
    'not really',
    'i don\'t want to',
    'i can\'t',
    'that won\'t help',
    'that doesn\'t work',
    'i tried that',
    'not now',
    'maybe later',
    'i don\'t feel like it'
  ];
  
  return refusalPhrases.some(phrase => lowerMessage.includes(phrase));
}

/**
 * Detect if user expressed distress (for LISTEN FIRST rule).
 */
function userExpressedDistress(userMessage: string): boolean {
  if (!userMessage || typeof userMessage !== 'string') {
    return false;
  }

  const lowerMessage = userMessage.toLowerCase();
  const distressIndicators = [
    'crying',
    'sad',
    'depressed',
    'anxious',
    'panic',
    'overwhelmed',
    'scared',
    'afraid',
    'worried',
    'stressed',
    'hurt',
    'pain',
    'lonely',
    'hopeless',
    'empty',
    'numb',
    'can\'t breathe',
    'chest tight',
    'dizzy'
  ];
  
  return distressIndicators.some(indicator => lowerMessage.includes(indicator));
}

/**
 * Detect if response contains advice/suggestions.
 */
function responseContainsAdvice(response: string): boolean {
  if (!response || typeof response !== 'string') {
    return false;
  }

  const lowerResponse = response.toLowerCase();
  
  // Advice indicators
  const advicePhrases = [
    'try',
    'you could',
    'you might',
    'maybe you could',
    'how about',
    'what if you',
    'suggest',
    'recommend',
    'one thing that helps',
    'one thing you could',
    'something that might help',
    'breathing',
    'walk',
    'music',
    'grounding',
    'meditation',
    'exercise',
    'water',
    'blanket'
  ];
  
  // Check if response contains advice phrases AND suggests an action
  const hasAdvicePhrase = advicePhrases.some(phrase => lowerResponse.includes(phrase));
  
  // Also check for imperative suggestions (commands)
  const hasImperative = /(just|simply|only) (do|try|take|get|put|use|listen|breathe|walk|drink)/i.test(response);
  
  return hasAdvicePhrase || hasImperative;
}

/**
 * Remove advice from response and rewrite to presence-only.
 */
function removeAdviceFromResponse(response: string): string {
  if (!response || typeof response !== 'string') {
    return response;
  }

  let cleaned = response;
  const lowerResponse = response.toLowerCase();
  
  // Remove advice phrases
  const advicePatterns = [
    /(try|you could|you might|maybe you could|how about|what if you|suggest|recommend|one thing that helps|one thing you could|something that might help)[^.!?]*/gi,
    /(just|simply|only) (do|try|take|get|put|use|listen|breathe|walk|drink)[^.!?]*/gi,
    /(breathing|walk|music|grounding|meditation|exercise|water|blanket)[^.!?]*/gi,
    /(or maybe|or you could|or try|alternatively)[^.!?]*/gi
  ];
  
  for (const pattern of advicePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Clean up extra spaces and punctuation
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  
  // If response is now empty or too short, use presence-only responses
  if (cleaned.length < 10) {
    const presenceResponses = [
      "I'm here with you.",
      "I hear you.",
      "That sounds really hard.",
      "I'm staying with you.",
      "Tell me what's happening."
    ];
    const hash = response.length % presenceResponses.length;
    cleaned = presenceResponses[hash];
  }
  
  return cleaned;
}

/**
 * Detect if user message contains crisis/self-harm language.
 */
function detectCrisisLanguage(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const lowerMessage = message.toLowerCase();
  const crisisPhrases = [
    'i want to harm myself',
    'i want to die',
    'kill myself',
    'end my life',
    'suicide',
    'kill myself',
    'hurt myself',
    'want to die',
    'don\'t want to live',
    'better off dead',
    'no point living',
    'end it all',
    'end everything'
  ];

  return crisisPhrases.some(phrase => lowerMessage.includes(phrase));
}

/**
 * Generate a human, present crisis response that bypasses normal AI flow.
 * This sounds like a close friend, not a clinician.
 */
function generateCrisisResponse(): string {
  // Calm, protective, hopeful crisis responses
  const crisisResponses = [
    "I hear how bad this feels. I'm here with you, and I don't want anything to happen to you. Let's slow this moment down together. Talk to me — what's making it feel unbearable?",
    "I'm here with you. This moment can pass. I care about you, and I want to help you get through this. What's going on right now?",
    "I hear you. I'm staying with you, and I don't want anything bad to happen. Let's talk through what's making this feel so impossible right now.",
    "I'm here. This feeling can pass. I care about you, and we can get through this together. Tell me what's happening.",
    "I hear how unbearable this feels. I'm here with you, and I want to help you stay safe. Let's slow down and talk — what's making it feel so heavy?"
  ];

  // Use a simple hash based on timestamp to vary responses
  const hash = Date.now() % crisisResponses.length;
  return crisisResponses[hash];
}

/**
 * Anti-repetition guard: Ensures understanding over mirroring.
 * Detects emotional keyword overlap and word overlap, rewrites responses to show actual understanding.
 * Tracks suggestions and removes explicit history references.
 */
function guardAntiRepetition(response: string, history: ChatMessage[], userMessage?: string, conversationId?: string, userId?: string, isCryingOrOverwhelmed?: boolean): string {
  if (!response || typeof response !== 'string') {
    return response;
  }

  let cleaned = response;
  const lowerResponse = response.toLowerCase();
  
  // CRYING/OVERWHELM MODE: Enforce 1-2 sentences, no questions, no advice
  if (isCryingOrOverwhelmed) {
    // Remove questions
    if (responseContainsQuestion(cleaned)) {
      cleaned = removeQuestionsFromResponse(cleaned);
    }
    
    // Remove advice
    if (responseContainsAdvice(cleaned)) {
      cleaned = removeAdviceFromResponse(cleaned);
    }
    
    // Enforce 1-2 sentences max
    const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 2) {
      cleaned = sentences.slice(0, 2).join('. ').trim() + '.';
    }
    
    // If too long, use presence-only response
    if (cleaned.split(/\s+/).length > 20) {
      const presenceResponses = [
        "I'm here with you.",
        "I'm staying with you.",
        "Take your time.",
        "I'm here."
      ];
      const hash = cleaned.length % presenceResponses.length;
      cleaned = presenceResponses[hash];
    }
    
    console.log('[AI] Crying/overwhelm mode - enforced presence-only response');
  }
  
  // EVENT-LEVEL MEMORY GUARD: Check if event was already acknowledged
  if (userMessage && conversationId) {
    const eventType = extractEventType(userMessage);
    const isAlreadyAcknowledged = isEventAlreadyAcknowledged(conversationId, eventType);
    const userAsksWhatToDo = userWantsAdvice(userMessage);
    
    if (eventType && isAlreadyAcknowledged) {
      // Event already acknowledged - do NOT repeat emotional reaction
      console.log('[AI] Event already acknowledged:', eventType, '- switching to post-acknowledgment mode');
      
      // Check if response contains emotional reaction phrases (indicating repetition)
      const emotionalReactionPhrases = [
        /that hurts/i,
        /that's painful/i,
        /that must be/i,
        /i can't imagine/i,
        /that's devastating/i,
        /that's heartbreaking/i,
        /i'm so sorry/i,
        /being betrayed/i,
        /that sucks/i,
        /that's awful/i
      ];
      
      const hasEmotionalReaction = emotionalReactionPhrases.some(pattern => pattern.test(cleaned));
      
      if (hasEmotionalReaction) {
        // Replace emotional reaction with post-acknowledgment response
        cleaned = generatePostAcknowledgmentResponse(eventType, userAsksWhatToDo);
        console.log('[AI] Replaced repeated emotional reaction with post-acknowledgment response');
      }
    } else if (eventType && !isAlreadyAcknowledged) {
      // New event - mark as acknowledged and allow emotional reaction
      markEventAsAcknowledged(conversationId, eventType);
      
      // REACTION-FIRST GUARD: For new major emotional disclosures, remove questions from same message
      const hasQuestion = responseContainsQuestion(cleaned);
      if (hasQuestion) {
        console.log('[AI] Major emotional disclosure detected - removing questions for reaction-first rule');
        cleaned = removeQuestionsFromResponse(cleaned);
      }
    }
  }
  
  // ADVICE GUARD: Track and enforce advice rules
  if (conversationId && userMessage) {
    // Track if user expressed distress
    if (userExpressedDistress(userMessage)) {
      userExpressedDistressMap.set(conversationId, true);
    }
    
    // Track if user refused advice
    const refusedAdvice = detectUserRefusedAdvice(userMessage);
    if (refusedAdvice) {
      userRefusedAdviceMap.set(conversationId, true);
      console.log('[AI] User refused advice - will not offer advice again unless explicitly asked');
      
      // Update user profile
      if (userId) {
        const userMessageLength = userMessage.trim().split(/\s+/).length;
        updateUserStyleProfile(userId, userMessage, userMessageLength, false, false);
      }
    }
    
    // Get previous assistant message (used for multiple checks)
    const previousAssistantMsg = history
      .slice()
      .reverse()
      .find(msg => msg.role === 'assistant');
    
    // Track if user accepted advice (check previous assistant message for advice)
    const lastHadAdvice = lastMessageHadAdvice.get(conversationId) || false;
    const userEngagedWithQuestion = userMessage && userMessage.length > 10; // Simple engagement check
    
    if (userId && lastHadAdvice && !refusedAdvice && userMessage && userMessage.length > 5) {
      // User didn't refuse advice and responded - might have accepted
      const userMessageLength = userMessage.trim().split(/\s+/).length;
      updateUserStyleProfile(userId, userMessage, userMessageLength, true, userEngagedWithQuestion);
    }
    
    // Check if user wants advice
    const wantsAdvice = userWantsAdvice(userMessage);
    
    // Check if user previously refused
    const previouslyRefused = userRefusedAdviceMap.get(conversationId) || false;
    
    // Check if user expressed distress (for LISTEN FIRST rule)
    const expressedDistress = userExpressedDistressMap.get(conversationId) || false;
    
    // Check if current response contains advice
    const hasAdvice = responseContainsAdvice(cleaned);
    
    const isFirstAfterDistress = expressedDistress && !previousAssistantMsg;
    
    // BLOCK ADVICE if:
    // 1. User refused advice and didn't explicitly ask again
    if (previouslyRefused && !wantsAdvice && hasAdvice) {
      console.log('[AI] Blocking advice - user previously refused');
      // Remove advice phrases and rewrite to presence-only
      cleaned = removeAdviceFromResponse(cleaned);
    }
    // 2. First reply after distress (LISTEN FIRST rule)
    else if (isFirstAfterDistress && hasAdvice) {
      console.log('[AI] Blocking advice - first reply after distress (LISTEN FIRST rule)');
      cleaned = removeAdviceFromResponse(cleaned);
    }
    // 3. User didn't ask for help and last message had advice
    else if (lastHadAdvice && !wantsAdvice && hasAdvice) {
      console.log('[AI] Blocking advice - user did not ask and last message had advice');
      cleaned = removeAdviceFromResponse(cleaned);
    }
    // 4. User didn't ask for help and no permission
    else if (!wantsAdvice && hasAdvice && !expressedDistress) {
      console.log('[AI] Blocking advice - user did not ask for help');
      cleaned = removeAdviceFromResponse(cleaned);
    }
    
    // Track if current response has advice (for next turn)
    if (responseContainsAdvice(cleaned)) {
      lastMessageHadAdvice.set(conversationId, true);
    } else {
      lastMessageHadAdvice.set(conversationId, false);
    }
    
    // If user explicitly asks for help, reset refusal flag
    if (wantsAdvice) {
      userRefusedAdviceMap.set(conversationId, false);
    }
  }

  // Step 1: Remove banned phrases and helping language
  const bannedPhrases = [
    /your call/gi,
    /it's your call/gi,
    /we can just talk,? or we can try (breathing|grounding)/gi,
    /we can talk,? or we can do something to calm/gi,
    /grounding or breathing thing/gi,
    /we can just talk/gi,
    /i want to help you/gi,
    /let me help you/gi,
    /we can do this together/gi,
    /i want to help you stay safe/gi
  ];

  for (const pattern of bannedPhrases) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Remove reassurance phrases (regex patterns)
  const reassurancePatterns = [
    /i'm really glad you told me/gi,
    /i'm really glad you reached out/gi,
    /that sounds heavy/gi,
    /i'm sorry you're feeling/gi
  ];
  
  for (const pattern of reassurancePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Step 1b: Remove explicit history references (unless user asked)
  const explicitHistoryPhrases = [
    /i noticed/i,
    /in your journal/i,
    /in your check-ins/i,
    /based on your posts/i,
    /from your journal/i,
    /your recent posts/i,
    /your check-ins/i
  ];
  
  // Check if user asked about history
  const userAskedAboutHistory = userMessage && (
    userMessage.toLowerCase().includes('remember') ||
    userMessage.toLowerCase().includes('do you know') ||
    userMessage.toLowerCase().includes('have i told you')
  );
  
  // Only remove explicit references if user didn't ask AND it hasn't been used yet
  if (conversationId && !userAskedAboutHistory) {
    const hasUsedExplicitRef = explicitHistoryReferenceUsed.get(conversationId) || false;
    
    if (!hasUsedExplicitRef) {
      // First time - allow it but mark as used
      const hasExplicitRef = explicitHistoryPhrases.some(pattern => pattern.test(cleaned));
      if (hasExplicitRef) {
        explicitHistoryReferenceUsed.set(conversationId, true);
        console.log('[AI] Explicit history reference detected and marked as used');
      }
    } else {
      // Already used - remove any explicit references
      for (const pattern of explicitHistoryPhrases) {
        cleaned = cleaned.replace(pattern, '');
      }
      // Clean up resulting double spaces
      cleaned = cleaned.replace(/\s+/g, ' ').trim();
    }
  } else if (!userAskedAboutHistory) {
    // No conversationId - remove all explicit references
    for (const pattern of explicitHistoryPhrases) {
      cleaned = cleaned.replace(pattern, '');
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
  }
  
  // Clean up extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();

  // Step 2: Collect all assistant messages from history to track banned phrases
  const allAssistantMessages = history
    .filter(msg => msg.role === 'assistant')
    .map(msg => msg.content.toLowerCase());
  
  const previousAssistantMsg = history
    .slice()
    .reverse()
    .find(msg => msg.role === 'assistant');

  // Step 2b: Check if this is the first assistant message
  const isFirstAssistantMessage = !previousAssistantMsg;
  
  if (isFirstAssistantMessage) {
    // First message: allow one warm greeting with a question
    // Only show opener if there are no previous user messages (truly new conversation)
    const hasPreviousUserMessages = history.some(msg => msg.role === 'user');
    
    if (!hasPreviousUserMessages) {
      // This is a truly new conversation - show greeting
      const trimmed = cleaned.trim();
      // Ensure it has a greeting and is warm
      if (!trimmed.toLowerCase().includes('hey') && !trimmed.toLowerCase().includes("i'm here")) {
        cleaned = "Hey, I'm here. How are you feeling right now?";
      }
      console.log('[AI] First message in new conversation - showing greeting');
    } else {
      // There are previous user messages, so this shouldn't be the first assistant message
      // This shouldn't happen, but if it does, don't show the opener
      console.log('[AI] Warning: First assistant message but previous user messages exist');
    }
    return cleaned;
  }

  // Convert to lowercase for all checks (must be declared before use)
  const lowerCleaned = cleaned.toLowerCase();
  const lowerUserMessage = (userMessage || '').toLowerCase();

  // Step 3: GREETINGS - Track across entire conversation (only allow once)
  const greetings = [
    "hey",
    "hi",
    "hello"
  ];
  
  // Check if any greeting was used before
  let hasRepeatedGreeting = false;
  let greetingFound = '';
  for (const greeting of greetings) {
    if (lowerCleaned.startsWith(greeting + ',') || lowerCleaned.startsWith(greeting + ' ')) {
      const wasUsedBefore = allAssistantMessages.some(msg => 
        msg.startsWith(greeting + ',') || msg.startsWith(greeting + ' ')
      );
      if (wasUsedBefore) {
        hasRepeatedGreeting = true;
        greetingFound = greeting;
        break;
      }
    }
  }
  
  // Step 3b: Check for repeated reassurance phrases
  const reassurancePhrases = [
    "i'm here with you",
    "i'm really glad you told me",
    "you're not alone",
    "i'm here for you"
  ];
  
  let hasRepeatedReassurance = false;
  let reassuranceFound = '';
  for (const phrase of reassurancePhrases) {
    if (lowerCleaned.includes(phrase)) {
      const wasUsedBefore = allAssistantMessages.some(msg => msg.includes(phrase));
      if (wasUsedBefore) {
        hasRepeatedReassurance = true;
        reassuranceFound = phrase;
        break;
      }
    }
  }
  
  // Step 3b: HARD BANNED REPETITIONS - Check if any banned phrase was used before
  const hardBannedPhrases = [
    "hey. i'm here with you",
    "i'm here with you",
    "i'm really glad you told me",
    "you're not alone right now",
    "i want to help you stay safe"
  ];

  // lowerCleaned already declared above (line 1142)
  let hasBannedRepetition = false;
  let bannedPhraseFound = '';

  for (const bannedPhrase of hardBannedPhrases) {
    // Check if current response contains this banned phrase
    if (lowerCleaned.includes(bannedPhrase)) {
      // Check if it was used in any previous assistant message
      const wasUsedBefore = allAssistantMessages.some(msg => msg.includes(bannedPhrase));
      if (wasUsedBefore) {
        hasBannedRepetition = true;
        bannedPhraseFound = bannedPhrase;
        break;
      }
    }
  }

  // Step 4: Calculate word overlap percentage with previous message
  const lowerPrevious = previousAssistantMsg.content.toLowerCase();
  const currentWords = lowerCleaned.split(/\s+/).filter(w => w.length > 2);
  const previousWords = lowerPrevious.split(/\s+/).filter(w => w.length > 2);
  
  const currentWordSet = new Set(currentWords);
  const previousWordSet = new Set(previousWords);
  
  let overlapCount = 0;
  for (const word of currentWordSet) {
    if (previousWordSet.has(word)) {
      overlapCount++;
    }
  }

  const totalUniqueWords = Math.max(currentWordSet.size, previousWordSet.size);
  const overlapPercentage = totalUniqueWords > 0 ? (overlapCount / totalUniqueWords) * 100 : 0;

  // Step 5: Detect emotional keyword overlap (mirroring vs understanding)
  let hasEmotionalMirroring = false;
  if (userMessage) {
    // lowerUserMessage already declared above (line 1143)
    const emotionalKeywords = [
      'depressed', 'depression', 'sad', 'sadness', 'crying', 'cry', 'anxious', 'anxiety',
      'panic', 'panicking', 'overwhelmed', 'overwhelming', 'hopeless', 'hopelessness',
      'lonely', 'loneliness', 'angry', 'anger', 'frustrated', 'frustration',
      'scared', 'afraid', 'fear', 'worried', 'worry', 'stressed', 'stress',
      'tired', 'exhausted', 'empty', 'numb', 'pain', 'hurting', 'hurt'
    ];
    
    // Check if response contains same emotional keywords as user message (mirroring)
    const userEmotionalWords = emotionalKeywords.filter(keyword => lowerUserMessage.includes(keyword));
    const responseEmotionalWords = emotionalKeywords.filter(keyword => lowerCleaned.includes(keyword));
    
    // If response repeats user's emotional words, it's likely mirroring
    if (userEmotionalWords.length > 0) {
      const repeatedEmotionalWords = userEmotionalWords.filter(word => 
        responseEmotionalWords.includes(word)
      );
      // If more than 50% of user's emotional words are repeated, it's mirroring
      if (repeatedEmotionalWords.length > 0 && 
          repeatedEmotionalWords.length >= userEmotionalWords.length * 0.5) {
        hasEmotionalMirroring = true;
      }
    }
    
    // Step 5b: Match user's message length/intensity
    const userLength = userMessage.trim().split(/\s+/).length;
    const responseLength = cleaned.trim().split(/\s+/).length;
    
    // If user sent short message but response is long, shorten it
    if (userLength <= 10 && responseLength > 30) {
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 0) {
        cleaned = sentences.slice(0, 2).join('. ').trim() + '.';
      }
    }
    // If user sent long/overwhelmed message, allow 3-4 sentences
    if (userLength > 20 && responseLength < 15) {
      // Allow response to be longer if user is overwhelmed
      // (but don't force it - let AI decide naturally)
    }
  }

  // Step 6: Remove repeated greeting if found
  if (hasRepeatedGreeting && greetingFound) {
    const regex = new RegExp('^' + greetingFound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[,\\s]*', 'gi');
    cleaned = cleaned.replace(regex, '').trim();
  }

  // Step 7: Remove repeated reassurance if found
  if (hasRepeatedReassurance && reassuranceFound) {
    const regex = new RegExp(reassuranceFound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    cleaned = cleaned.replace(regex, '').replace(/\s+/g, ' ').trim();
  }

  // Step 6: Track and detect repeated suggestions
  const suggestionKeywords = ['water', 'blanket', 'music', 'walk', 'breathing', 'grounding', 'meditation', 'exercise', 'friend', 'talk'];
  const currentSuggestions: string[] = [];
  suggestionKeywords.forEach(keyword => {
    if (lowerCleaned.includes(keyword)) {
      currentSuggestions.push(keyword);
    }
  });
  
  let hasRepeatedSuggestion = false;
  if (conversationId && currentSuggestions.length > 0) {
    const previousSuggestions = conversationSuggestions.get(conversationId) || [];
    // Check if any current suggestion was used in last 2 turns
    hasRepeatedSuggestion = currentSuggestions.some(suggestion => 
      previousSuggestions.includes(suggestion)
    );
    
    if (!hasRepeatedSuggestion) {
      // Update suggestion history (keep last 2)
      const updatedSuggestions = [...previousSuggestions, ...currentSuggestions].slice(-2);
      conversationSuggestions.set(conversationId, updatedSuggestions);
    }
  }

  // Step 7: If >25% overlap, emotional mirroring, banned repetition, or repeated suggestion detected, rewrite response
  if (overlapPercentage > 25 || hasBannedRepetition || hasRepeatedReassurance || hasEmotionalMirroring || hasRepeatedSuggestion) {
    // Remove the banned phrase if found
    if (hasBannedRepetition && bannedPhraseFound) {
      const regex = new RegExp(bannedPhraseFound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      cleaned = cleaned.replace(regex, '').replace(/\s+/g, ' ').trim();
    }

    // If >25% overlap or repeated suggestion, rewrite shorter with different wording
    if (overlapPercentage > 25 || hasRepeatedSuggestion) {
      // Rewrite to be shorter (2-3 sentences max) with different wording
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 0) {
        // Take first 2 sentences max, ensure they're different
        const shortened = sentences.slice(0, 2).join('. ').trim() + '.';
        // If still too similar, use a completely different response
        if (shortened.length > 0 && shortened.length < cleaned.length * 0.7) {
          cleaned = shortened;
        } else {
          // Use a short, varied response
          const shortResponses = [
            "I hear you.",
            "That sounds really hard.",
            "I'm here with you.",
            "Tell me what's happening.",
            "What's going on?"
          ];
          const hash = cleaned.length % shortResponses.length;
          cleaned = shortResponses[hash];
        }
      }
    } else if (hasEmotionalMirroring) {
      // If emotional mirroring detected, rewrite to show understanding
      const understandingResponses = [
        "That sounds really hard to carry.",
        "Everything must feel too heavy right now.",
        "I can hear how much this is weighing on you.",
        "It sounds like you're holding a lot right now.",
        "This must feel overwhelming.",
        "I hear how difficult this is for you.",
        "That sounds like it's really weighing you down."
      ];
      
      const hash = cleaned.length % understandingResponses.length;
      cleaned = understandingResponses[hash];
    } else {
      // Generate natural, varied responses
      const naturalResponses = [
        "That sounds really hard.",
        "I'm here with you.",
        "Tell me more about that.",
        "I hear you.",
        "What's going on?",
        "That makes sense.",
        "I understand."
      ];

      // If cleaned response is still meaningful after removing banned phrase, keep it but ensure it's natural
      if (cleaned.length > 10 && !hasBannedRepetition && !hasRepeatedReassurance) {
        // Keep it but ensure it doesn't repeat structure (2-3 sentences max)
        const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length > 0) {
          // Use first 2 sentences max (default 2-3 sentences rule)
          if (sentences.length > 2) {
            cleaned = sentences.slice(0, 2).join('. ').trim() + '.';
          } else if (sentences.length > 1 && (sentences[0].length + sentences[1].length) < 120) {
            cleaned = sentences.slice(0, 2).join('. ').trim() + '.';
          } else {
            cleaned = sentences[0].trim() + '.';
          }
        }
      } else {
        // Use a natural response
        const hash = cleaned.length % naturalResponses.length;
        cleaned = naturalResponses[hash];
      }
    }
  }

  // Step 9: Final check - remove any remaining repeated greetings and reassurance
  // Recalculate lowercase in case cleaned was modified
  const lowerCleanedFinal = cleaned.toLowerCase();
  for (const greeting of greetings) {
    if (lowerCleanedFinal.startsWith(greeting + ',') || lowerCleanedFinal.startsWith(greeting + ' ')) {
      const wasUsedBefore = allAssistantMessages.some(msg => 
        msg.startsWith(greeting + ',') || msg.startsWith(greeting + ' ')
      );
      if (wasUsedBefore) {
        const regex = new RegExp('^' + greeting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[,\\s]*', 'gi');
        cleaned = cleaned.replace(regex, '').trim();
      }
    }
  }
  
  for (const phrase of reassurancePhrases) {
    if (lowerCleanedFinal.includes(phrase)) {
      const wasUsedBefore = allAssistantMessages.some(msg => msg.includes(phrase));
      if (wasUsedBefore) {
        const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        cleaned = cleaned.replace(regex, '').replace(/\s+/g, ' ').trim();
      }
    }
  }
  
  for (const bannedPhrase of hardBannedPhrases) {
    // Recalculate lowercase in case cleaned was modified
    const lowerCleanedFinalCheck = cleaned.toLowerCase();
    if (lowerCleanedFinalCheck.includes(bannedPhrase)) {
      const wasUsedBefore = allAssistantMessages.some(msg => msg.includes(bannedPhrase));
      if (wasUsedBefore) {
        const regex = new RegExp(bannedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        cleaned = cleaned.replace(regex, '').replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Ensure response is not empty (use quiet presence)
  if (!cleaned || cleaned.trim().length < 5) {
    cleaned = "I'm here.";
  }

  return cleaned;
}

/**
 * Remove repetitive phrases from AI response to make it sound more human.
 * Removes "I noticed" and "check-ins/journal" references if they appear more than once.
 */
function cleanRepetitivePhrases(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let cleaned = text;
  const lowerText = text.toLowerCase();

  // Count occurrences of repetitive phrases
  const noticedMatches = (lowerText.match(/i noticed/g) || []).length;
  const checkInsMatches = (lowerText.match(/(check-ins?|journal entries?|recent (posts|entries|notes))/gi) || []).length;

  // If "I noticed" appears more than once, remove all but the first occurrence
  if (noticedMatches > 1) {
    let first = true;
    cleaned = cleaned.replace(/i noticed/gi, (match) => {
      if (first) {
        first = false;
        return match;
      }
      return ''; // Remove subsequent occurrences
    });
    // Clean up double spaces and punctuation issues
    cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  }

  // If "check-ins/journal" appears more than once, remove all but the first occurrence
  if (checkInsMatches > 1) {
    const patterns = [
      /check-ins?/gi,
      /journal entries?/gi,
      /recent posts/gi,
      /recent entries/gi,
      /recent notes/gi
    ];
    
    for (const pattern of patterns) {
      let first = true;
      cleaned = cleaned.replace(pattern, (match) => {
        if (first) {
          first = false;
          return match;
        }
        return ''; // Remove subsequent occurrences
      });
    }
    // Clean up double spaces and punctuation issues
    cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  }

  return cleaned;
}

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
  userContext?: { recentPosts?: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> },
  conversationId?: string,
  userId?: string
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

  // Generate personal context summary (1-3 bullet points, subtle and stable)
  if (userContext?.recentPosts && userContext.recentPosts.length > 0) {
    const personalSummary = generatePersonalContextSummary(userContext.recentPosts);
    if (personalSummary) {
      context += `Personal context (use silently, do not mention explicitly):\n${personalSummary}\n\n`;
    }
  }

  // Update user style profile if userId provided
  if (userId && message) {
    const userMessageLength = message.trim().split(/\s+/).length;
    const adviceAccepted = null; // Will be updated in guard
    const questionEngagement = false; // Will be updated based on response
    updateUserStyleProfile(userId, message, userMessageLength, adviceAccepted, questionEngagement);
  }

  // Get user style profile for language and response length
  const userProfile = userId ? getUserStyleProfile(userId) : null;
  const userLanguage = userProfile?.detectedLanguage || detectUserLanguage(message);
  
  // Check for crying/overwhelm mode
  const isCryingOrOverwhelmed = detectCryingOrOverwhelm(message);
  
  // Add language instruction if non-English detected
  if (userLanguage !== 'english') {
    const languageInstruction = userLanguage === 'hindi' 
      ? 'IMPORTANT: Respond in Hindi (Devanagari script). Match the user\'s casual tone.\n\n'
      : userLanguage === 'hinglish'
      ? 'IMPORTANT: Respond in Hinglish (mix of Hindi and English). Match the user\'s casual tone and language mix.\n\n'
      : 'IMPORTANT: Match the user\'s language style and respond naturally.\n\n';
    context += languageInstruction;
  }
  
  // Add crying/overwhelm mode instruction
  if (isCryingOrOverwhelmed) {
    context += `USER STATE: User is crying or overwhelmed. Prioritize presence. 1-2 sentences max. No questions unless user initiates. No action suggestions.\n\n`;
  }

  // Build prompt with system instructions
  const prompt = `${SYSTEM_PROMPT}\n\n${context}Current message: ${message || 'Start'}`;

  const response = await askOllama(prompt, context || 'No previous context');
  const cleaned = cleanRepetitivePhrases(response);
  return guardAntiRepetition(cleaned, history, message, conversationId, userId, isCryingOrOverwhelmed);
}

/**
 * Get AI panic response with conversation history and user context.
 * Uses the active provider (OpenAI or Ollama) based on configuration.
 * Throws error if API call fails (caller should handle).
 */
export async function getAIPanicResponse(
  message: string,
  history: ChatMessage[] = [],
  userContext?: { recentPosts?: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> },
  conversationId?: string,
  userId?: string
): Promise<string> {
  // CRISIS OVERRIDE: If crisis language detected, bypass normal AI and return human crisis response
  if (detectCrisisLanguage(message)) {
    console.log('[AI] Crisis language detected, using override response');
    return generateCrisisResponse();
  }

  // Update user style profile if userId provided
  if (userId && message) {
    const userMessageLength = message.trim().split(/\s+/).length;
    const adviceAccepted = null; // Will be updated in guard
    const questionEngagement = false; // Will be updated based on response
    updateUserStyleProfile(userId, message, userMessageLength, adviceAccepted, questionEngagement);
  }

  // Get user style profile for language and response length
  const userProfile = userId ? getUserStyleProfile(userId) : null;
  const userLanguage = userProfile?.detectedLanguage || detectUserLanguage(message);
  
  // Check for crying/overwhelm mode
  const isCryingOrOverwhelmed = detectCryingOrOverwhelm(message);

  const provider = getAIProvider();

  if (provider === 'ollama') {
    return await getAIPanicResponseOllama(message, history, userContext, conversationId, userId);
  }

  // Default to OpenAI
  // Build input string from system prompt and conversation history
  let inputText = `System: ${SYSTEM_PROMPT}\n\n`;
  
  // Filter out assistant messages to check if this is truly the first user message
  const userMessages = history.filter(msg => msg.role === 'user');
  const isFirstUserMessage = userMessages.length === 0;
  
  // Check if explicit history reference has been used in this conversation
  const hasUsedExplicitReference = conversationId ? explicitHistoryReferenceUsed.get(conversationId) || false : false;
  
  // Generate personal context summary (1-3 bullet points, subtle and stable)
  if (userContext?.recentPosts && userContext.recentPosts.length > 0) {
    const personalSummary = generatePersonalContextSummary(userContext.recentPosts);
    if (personalSummary) {
      // Only include personal context summary, not raw history dump
      inputText += `Personal context (use silently, do not mention explicitly):\n${personalSummary}\n\n`;
    }
  }
  
  // Add FULL conversation history (including all previous user and assistant messages)
  // The history already includes the current user message (added by controller)
  for (const msg of history) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    inputText += `${roleLabel}: ${msg.content}\n\n`;
  }
  
  // If no history and no message, add Start message
  if (history.length === 0 && (!message || !message.trim())) {
    inputText += `User: Start\n\n`;
  }

  // Log conversation state
  console.log('[AI] OpenAI request - conversation history length:', history.length);
  console.log('[AI] OpenAI request - isFirstUserMessage:', isFirstUserMessage);
  console.log('[AI] OpenAI request - input text length:', inputText.length, 'chars');

  const response = await getAIResponse(inputText);
  const cleaned = cleanRepetitivePhrases(response);
  return guardAntiRepetition(cleaned, history, message, conversationId, userId, isCryingOrOverwhelmed);
}


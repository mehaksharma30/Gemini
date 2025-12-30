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
  detectedLanguage: 'english'; // User's language (English only)
  messageCount: number; // Track for gradual learning
}

const userStyleProfiles = new Map<string, UserStyleProfile>();

const SYSTEM_PROMPT = `You are ONE real, caring human friend.

You are not a therapist.
You are not a chatbot.
You are not here to sound correct.
You are here to make the user feel LESS ALONE and MORE SAFE.

Always reply ONLY in English.

────────────────────────
HOW YOU TALK
────────────────────────
- Talk like a close friend who genuinely cares.
- Warm, reassuring, calm.
- No robotic lines.
- No scripts.
- No menus.
- No commands.

You don't rush.
You don't lecture.
You stay.

CRITICAL ANTI-LOOP RULE:
- Never repeat the same supportive line twice in a row.
- If you already said "I'm here with you" or "I'm really glad you told me", switch to a different angle.
- Vary your language naturally. Each reply must feel fresh, not templated.

HARD BANNED PHRASES (use alternatives instead):
- ❌ "I'm really glad you reached out" → ✅ "I'm here." / "Yeah, I'm listening."
- ❌ "I want to understand what you're going through" → ✅ "Talk to me—what's spiking it right now?" / "What happened right before it started?"
- ❌ "Can you tell me more?" → ✅ "What's going on?" / "What happened?" / "Talk to me."

────────────────────────
HOW YOU LISTEN
────────────────────────
- First, understand what the user is REALLY feeling.
- Respond to the emotion, not just the words.
- Do NOT repeat their exact sentence back.
- Reflect meaning, not text.

────────────────────────
WHEN USER IS SAD / DEPRESSED
────────────────────────
- Reassure presence.
- Make them feel supported.
- Invite them to share, gently.

Tone example:
"I'm really glad you told me. I'm here, and we can take this one step at a time."

────────────────────────
WHEN USER IS OVERWHELMED / CRYING
────────────────────────
- Presence first.
- Few words.
- Soft reassurance.
- No fixing unless they ask.

Example:
"I'm here. You don't have to be okay right now. I've got you."

────────────────────────
PANIC ATTACK HANDLING (FRIEND STYLE - CRITICAL)
────────────────────────
When user says "panic attack" or "having a panic attack":
- Respond in 2–4 sentences:
  1) Confirm + reassure ("I'm here. Panic attacks are scary, but they pass.")
  2) Ask ONE simple question about safety/body (e.g., "Are you somewhere you can sit?")
  3) Offer ONE tiny grounding action ONLY if user seems stuck (not always)
- Keep it calm, human, not robotic.
- Don't dump long checklists.
- Don't use generic phrases like "I want to understand what you're going through."

Example response:
"I'm here. Panic attacks are really scary, but they do pass. Are you somewhere you can sit down? If you want, try putting both feet flat on the floor and taking one slow breath."

────────────────────────
SELF-HARM / FEELING UNSAFE (VERY IMPORTANT)
────────────────────────
If the user says they want to hurt themselves or feel unsafe:

You MUST:
1) Show care and concern immediately.
2) Reassure that you are here and they are not alone.
3) Validate the PAIN, not the action.
4) Gently slow things down.
5) Ask at most ONE gentle safety question.
6) Encourage safety and reaching out, without panic.

NEVER say:
- "That makes sense"
- "I understand why you'd do that"
- Cold one-liners

Correct tone example:
"Hey… I'm really glad you told me. I care about you, and I'm here with you right now. I can hear how much pain you're in, and we don't have to solve everything at once. Are you somewhere safe right now?"

If danger becomes immediate or repeated, gently encourage contacting someone trusted or emergency help.

────────────────────────
ADVICE & SOLUTIONS
────────────────────────
- Do NOT give advice by default.
- Give advice ONLY if the user asks or feels stuck.
- One small, gentle suggestion at a time.
- Say things like:
  "We'll figure this out together."
  "We can look for a way forward, slowly."

────────────────────────
STYLE RULES
────────────────────────
- Sound human, not perfect.
- Sometimes short.
- Sometimes 2–4 sentences.
- Never end abruptly.
- Never feel cold or dismissive.
- Never repeat the same supportive line twice in a row.

You are a friend who says:
"I'm here. You don't have to face this alone."

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
 * Build history evidence pack from recent posts when user asks about history.
 * Returns relevant posts matching keywords from user's question.
 */
function buildHistoryEvidencePack(
  recentPosts: Array<{ title: string; content: string; tags: string[]; createdAt: Date }>,
  userMessage: string
): string {
  if (!recentPosts || recentPosts.length === 0) {
    return "No relevant journal notes found for that topic.";
  }

  // Extract keywords from user message
  const lowerMessage = userMessage.toLowerCase();
  const keywords: string[] = [];
  
  // Common emotional/event keywords
  const keywordPatterns = [
    /panic(?: attack)?/i,
    /anxiety/i,
    /depressed|depression/i,
    /crying|cried/i,
    /self-harm|hurt myself|suicide/i,
    /breakup|broke up/i,
    /cheat|cheated|cheating/i,
    /death|died|loss|grief/i,
    /anxious|anxiety/i,
    /overwhelmed|overwhelm/i,
    /sad|sadness/i,
    /angry|anger/i,
    /stressed|stress/i
  ];
  
  keywordPatterns.forEach(pattern => {
    const match = userMessage.match(pattern);
    if (match) {
      keywords.push(match[0].toLowerCase());
    }
  });

  if (keywords.length === 0) {
    // No specific keywords, return general message
    return "No specific topic mentioned. I can see you have journal entries, but I'd need to know what you're looking for.";
  }

  // Score posts based on keyword matches and recency
  const scoredPosts = recentPosts.map(post => {
    let score = 0;
    const lowerTitle = (post.title || '').toLowerCase();
    const lowerContent = (post.content || '').toLowerCase();
    const lowerTags = (post.tags || []).map(t => t.toLowerCase());
    
    // Keyword matches in title (higher weight)
    keywords.forEach(keyword => {
      if (lowerTitle.includes(keyword)) score += 3;
      if (lowerContent.includes(keyword)) score += 2;
      if (lowerTags.some(tag => tag.includes(keyword))) score += 2;
    });
    
    // Recency boost (more recent = higher score)
    const daysAgo = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.max(0, 5 - daysAgo); // Boost decreases over 5 days
    score += recencyBoost;
    
    return { post, score };
  });

  // Sort by score and take top 3
  const topPosts = scoredPosts
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.post);

  if (topPosts.length === 0) {
    return "No relevant journal notes found for that topic.";
  }

  // Build evidence pack (max 6 lines total)
  let evidencePack = "Relevant journal notes (for assistant use):\n";
  
  topPosts.forEach((post, idx) => {
    if (idx >= 3) return; // Max 3 posts
    
    const date = new Date(post.createdAt).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: new Date(post.createdAt).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
    
    const title = post.title || 'Untitled';
    const contentSnippet = (post.content || '').substring(0, 140).trim();
    const snippet = contentSnippet.length < (post.content || '').length 
      ? contentSnippet + '...' 
      : contentSnippet;
    
    evidencePack += `- ${date}: "${title}" - ${snippet}\n`;
  });

  return evidencePack.trim();
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
 * Detect user's language (always English).
 */
function detectUserLanguage(userMessage: string): 'english' {
  // Always return English - Hindi/Hinglish support removed
  return 'english';
}

/**
 * Detect if user is having a panic attack
 */
function detectPanicAttack(userMessage: string): boolean {
  if (!userMessage || typeof userMessage !== 'string') {
    return false;
  }

  const lowerMessage = userMessage.toLowerCase();
  const panicIndicators = [
    'panic attack',
    'having a panic attack',
    'having panic',
    'panic right now',
    'panicking',
    'full panic'
  ];
  
  return panicIndicators.some(indicator => lowerMessage.includes(indicator));
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
      "Yeah—I'm here. Take your time. What's going on?"
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
    "Hey… I'm really glad you told me. I care about you, and I'm here with you right now. I can hear how much pain you're in, and we don't have to solve everything at once. Are you somewhere safe right now?",
    "I'm really glad you told me. I'm here with you. You're not alone right now. I can hear how much this is hurting you. Are you somewhere safe?",
    "I'm really glad you said that out loud. I'm here with you, and I care about you. This pain you're feeling—we can work through it together. Are you somewhere safe right now?",
    "Thank you for telling me. I'm here with you, and you don't have to face this alone. I can hear how much you're hurting. Are you somewhere safe?",
    "I'm really glad you told me. I'm here with you right now, and I care about you. We don't have to figure everything out at once. Are you somewhere safe?"
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
  
  // ANTI-LOOP CHECK: Detect if response contains banned template phrases
  const bannedTemplatePhrases = [
    "I'm really glad you reached out. I'm here, and I want to understand what you're going through. Can you tell me more?",
    "I'm really glad you reached out",
    "I want to understand what you're going through",
    "Can you tell me more?"
  ];

  const responseContainsBannedPhrase = bannedTemplatePhrases.some(phrase => 
    cleaned.toLowerCase().includes(phrase.toLowerCase())
  );

  // Check if previous assistant message also had similar template
  const prevAssistantForLoopCheck = history
    .slice()
    .reverse()
    .find(msg => msg.role === 'assistant');

  if (responseContainsBannedPhrase && prevAssistantForLoopCheck) {
    const prevContainsBanned = bannedTemplatePhrases.some(phrase =>
      prevAssistantForLoopCheck.content.toLowerCase().includes(phrase.toLowerCase())
    );
    
    if (prevContainsBanned) {
      // Template loop detected - replace with varied response
      console.log('[AI] Template loop detected - replacing with varied response');
      const variedResponses = [
        "I'm here. What's going on?",
        "Talk to me—what's spiking it right now?",
        "I'm staying with you. What happened?",
        "I'm here with you. What happened right before it started?"
      ];
      const hash = cleaned.length % variedResponses.length;
      cleaned = variedResponses[hash];
    }
  }
  
  // CRYING/OVERWHELM MODE: Enforce 1-2 sentences, no questions, no advice, BUT keep warmth
  if (isCryingOrOverwhelmed) {
    // Remove questions
    if (responseContainsQuestion(cleaned)) {
      cleaned = removeQuestionsFromResponse(cleaned);
    }
    
    // Remove advice
    if (responseContainsAdvice(cleaned)) {
      cleaned = removeAdviceFromResponse(cleaned);
    }
    
    // Enforce 1-2 sentences max, but ensure warmth is preserved
    const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 2) {
      cleaned = sentences.slice(0, 2).join('. ').trim() + '.';
    }
    
    // If too long, use warm presence response (not just "I'm here")
    if (cleaned.split(/\s+/).length > 20) {
      const warmPresenceResponses = [
        "I'm here with you. You don't have to be okay right now.",
        "I'm staying with you. It's okay to let it out.",
        "I'm here. You don't have to be strong right now. I've got you."
      ];
      const hash = cleaned.length % warmPresenceResponses.length;
      cleaned = warmPresenceResponses[hash];
    }
    
    console.log('[AI] Crying/overwhelm mode - enforced warm presence response (1-2 sentences)');
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
    const userEngagedWithQuestion = !!(userMessage && userMessage.length > 10); // Simple engagement check (explicit boolean)
    
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

  // Step 1: Remove ONLY truly problematic phrases (not caring language)
  // Keep caring phrases like "I'm here with you", "I'm really glad you told me", etc.
  const bannedPhrases = [
    /your call/gi,
    /it's your call/gi,
    /we can just talk,? or we can try (breathing|grounding)/gi,
    /we can talk,? or we can do something to calm/gi,
    /grounding or breathing thing/gi
    // Removed: "we can just talk", "i want to help you", "let me help you", etc. - these are caring
  ];

  for (const pattern of bannedPhrases) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // REMOVED: reassurancePatterns removal - we want to keep caring reassurance phrases
  
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
  
  // Check if user asked about history (strengthened detection)
  const userAskedAboutHistory = userMessage && (
    userMessage.toLowerCase().includes('remember') ||
    userMessage.toLowerCase().includes('do you know') ||
    userMessage.toLowerCase().includes('have i told you') ||
    userMessage.toLowerCase().includes('did i mention') ||
    userMessage.toLowerCase().includes('did i write') ||
    userMessage.toLowerCase().includes('post') ||
    userMessage.toLowerCase().includes('posted') ||
    userMessage.toLowerCase().includes('journal') ||
    userMessage.toLowerCase().includes('record') ||
    userMessage.toLowerCase().includes('check') ||
    userMessage.toLowerCase().includes('lately') ||
    userMessage.toLowerCase().includes('recently') ||
    userMessage.toLowerCase().includes('last time') ||
    userMessage.toLowerCase().includes('before') ||
    userMessage.toLowerCase().includes('earlier') ||
    userMessage.toLowerCase().includes('see if') ||
    userMessage.toLowerCase().includes('see whether') ||
    /did i (post|write|mention|say)/i.test(userMessage) ||
    /what did i (post|write|say)/i.test(userMessage) ||
    /(see|check|look).*(post|journal|record)/i.test(userMessage)
  );
  
  // Only remove explicit references if user didn't ask
  if (!userAskedAboutHistory) {
    if (conversationId) {
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
    } else {
      // No conversationId - remove all explicit references
      for (const pattern of explicitHistoryPhrases) {
        cleaned = cleaned.replace(pattern, '');
      }
      cleaned = cleaned.replace(/\s+/g, ' ').trim();
    }
  } else {
    // User asked about history - DO NOT remove explicit references
    console.log('[AI] User asked about history - allowing explicit references');
  }
  
  // Clean up extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();

  // Step 2: Collect all assistant messages from history to track banned phrases
  const allAssistantMessages = history
    .filter(msg => msg.role === 'assistant')
    .map(msg => msg.content.toLowerCase());
  
  // Get previous assistant message (used for multiple checks)
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
  
  // Step 3b: EXACT-SAME-SENTENCE REPETITION ONLY - Check if current message is near-duplicate of previous
  let isNearDuplicateMessage = false;
  if (previousAssistantMsg) {
    isNearDuplicateMessage = isNearDuplicate(previousAssistantMsg.content, cleaned);
    if (isNearDuplicateMessage) {
      console.log('[AI] Near-duplicate detected - will rephrase instead of deleting warmth');
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

  // Step 7: If near-duplicate, high overlap, emotional mirroring, or repeated suggestion detected, rewrite response
  // Note: We removed hasBannedRepetition and hasRepeatedReassurance checks - we want to keep caring phrases
  if (isNearDuplicateMessage || overlapPercentage > 25 || hasEmotionalMirroring || hasRepeatedSuggestion) {
    // If near-duplicate, rephrase with alternate wording (don't delete to emptiness)
    if (isNearDuplicateMessage) {
      // Rephrase with similar meaning but different words
      const alternatePhrasings = [
        "I'm here with you. What's going on?",
        "I'm really glad you told me. I'm here, and we can take this one step at a time.",
        "I hear you. I'm staying with you right now.",
        "I'm here. You don't have to face this alone."
      ];
      const hash = cleaned.length % alternatePhrasings.length;
      cleaned = alternatePhrasings[hash];
      console.log('[AI] Rephrased near-duplicate message with alternate wording');
    }
    // If >25% overlap or repeated suggestion, rewrite shorter with different wording
    else if (overlapPercentage > 25 || hasRepeatedSuggestion) {
      // Rewrite to be shorter (2-3 sentences max) with different wording
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 0) {
        // Take first 2 sentences max, ensure they're different
        const shortened = sentences.slice(0, 2).join('. ').trim() + '.';
        // If still too similar, use a warm, varied response (not empty validation)
        if (shortened.length > 0 && shortened.length < cleaned.length * 0.7) {
          cleaned = shortened;
        } else {
          // Use a warm, varied response (not empty validation)
          const warmResponses = [
            "I'm here with you. That sounds really hard.",
            "I'm really glad you told me. I'm here, and we can take this one step at a time.",
            "I'm here. You don't have to face this alone. What's going on?",
            "I'm staying with you. Talk to me—what happened?",
            "I'm here with you. What's spiking it right now?"
          ];
          const hash = cleaned.length % warmResponses.length;
          cleaned = warmResponses[hash];
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
        "I'm really glad you told me. I'm here with you.",
        "That sounds like it's really weighing you down."
      ];
      
      const hash = cleaned.length % understandingResponses.length;
      cleaned = understandingResponses[hash];
    } else {
      // Generate warm, varied responses (not empty validation)
      const warmResponses = [
        "I'm here with you. That sounds really hard.",
        "I'm really glad you told me. I'm here, and we can take this one step at a time.",
        "I'm here. You don't have to face this alone. What happened?",
        "I'm staying with you. Talk to me—what happened?",
        "I'm here with you. What's been weighing on you?",
        "I'm really glad you reached out. I'm here, and we can work through this together.",
        "I'm here. That sounds really difficult. What happened right before it started?"
      ];

      // If cleaned response is still meaningful, keep it but ensure it's natural
      if (cleaned.length > 10) {
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
        // Use a warm response (not empty validation)
        const hash = cleaned.length % warmResponses.length;
        cleaned = warmResponses[hash];
      }
    }
  }

  // Step 9: REMOVED - Final check for repeated greetings/reassurance/banned phrases
  // We now only check for exact-same-sentence repetition (isNearDuplicate), not phrase-level repetition
  // This allows caring phrases like "I'm here with you" to be used multiple times if needed

  // Ensure response is not empty (use quiet presence)
  if (!cleaned || cleaned.trim().length < 5) {
    cleaned = "I'm here.";
  }

  // Final step: Enforce friend response completeness
  const isSelfHarm = userMessage ? /(hurt myself|kill myself|want to die|not safe|unsafe|suicide)/i.test(userMessage) : false;
  cleaned = enforceFriendCompleteness(cleaned, userMessage || '', { 
    isCryingOrOverwhelmed, 
    isSelfHarm 
  });

  return cleaned;
}

/**
 * Check if two messages are near duplicates (same sentence or very similar).
 * Returns true if normalized strings are equal OR similarity > 0.85.
 */
function isNearDuplicate(prev: string, cur: string): boolean {
  if (!prev || !cur) return false;
  
  // Normalize: lowercase, remove extra spaces, remove punctuation
  const normalize = (text: string): string => {
    return text.toLowerCase()
      .replace(/[.,!?;:]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  
  const normalizedPrev = normalize(prev);
  const normalizedCur = normalize(cur);
  
  // Check exact match after normalization
  if (normalizedPrev === normalizedCur) {
    return true;
  }
  
  // Check similarity using token overlap
  const prevTokens = new Set(normalizedPrev.split(/\s+/).filter(w => w.length > 2));
  const curTokens = new Set(normalizedCur.split(/\s+/).filter(w => w.length > 2));
  
  if (prevTokens.size === 0 || curTokens.size === 0) {
    return false;
  }
  
  // Calculate Jaccard similarity (intersection / union)
  const intersection = new Set([...prevTokens].filter(x => curTokens.has(x)));
  const union = new Set([...prevTokens, ...curTokens]);
  const similarity = intersection.size / union.size;
  
  return similarity > 0.85;
}

/**
 * Enforce friend response completeness - ensure responses are warm, caring, and complete.
 * Replaces empty validation responses with proper friend-like responses.
 */
function enforceFriendCompleteness(
  reply: string, 
  userMessage: string, 
  flags: { isCryingOrOverwhelmed?: boolean; isSelfHarm?: boolean }
): string {
  if (!reply || typeof reply !== 'string') {
    reply = "I'm here with you.";
  }
  
  const trimmed = reply.trim();
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
  
  // Check for empty validation patterns
  const emptyValidationPattern = /^(i hear you|that sounds hard|what's going on|that makes sense|i understand)\.?$/i;
  const isEmptyValidation = emptyValidationPattern.test(trimmed);
  
  // If too short (< 12 words) OR empty validation, replace with caring response
  if (wordCount < 12 || isEmptyValidation) {
    // Detect self-harm language
    const selfHarmPattern = /(hurt myself|kill myself|want to die|not safe|unsafe|suicide)/i;
    const isSelfHarm = selfHarmPattern.test(userMessage || '');
    
    if (isSelfHarm || flags.isSelfHarm) {
      // Self-harm response: warm, protective, 1 safety question max
      return "Hey… I'm really glad you told me. I care about you, and I'm here with you right now. I can hear how much pain you're in, and we don't have to solve everything at once. Are you somewhere safe right now?";
    } else if (flags.isCryingOrOverwhelmed) {
      // Crying/overwhelm: presence + soft reassurance (1-2 sentences)
      const presenceResponses = [
        "I'm here. You don't have to be okay right now. I've got you.",
        "I'm here with you. It's okay to let it out.",
        "I'm staying with you. You don't have to be strong right now."
      ];
      const hash = trimmed.length % presenceResponses.length;
      return presenceResponses[hash];
    } else {
      // General caring response: presence + validate emotion + gentle continuation
      const caringResponses = [
        "I'm really glad you told me. I'm here with you, and we can take this one step at a time. What's been weighing on you?",
        "I'm here with you. That sounds really hard to carry. You don't have to face this alone.",
        "Talk to me—what's spiking it right now?"
      ];
      const hash = trimmed.length % caringResponses.length;
      return caringResponses[hash];
    }
  }
  
  return reply;
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
  userId?: string,
  detectedLang?: 'en' // Optional: detected language from STT (always 'en' - English only)
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

  // Reply language is always English (Hindi support removed)
  const replyLanguage: 'english' = 'english';
  console.log('[AI] [LANGUAGE] Reply language: English (always)');
  console.log('[AI] [LANGUAGE] Latest user message (first 60 chars):', message.substring(0, 60));
  
  // Check for crying/overwhelm mode
  const isCryingOrOverwhelmed = detectCryingOrOverwhelm(message);
  
  // Check for panic attack
  const isPanicAttack = detectPanicAttack(message);
  
  // Add panic attack instruction if detected
  if (isPanicAttack) {
    context += `PANIC ATTACK DETECTED: User is having a panic attack. Respond in 2-4 sentences: 1) Confirm + reassure, 2) Ask ONE simple safety/body question, 3) Offer ONE tiny grounding action only if needed. Keep it calm, human, not robotic.\n\n`;
  }
  
  // Add crying/overwhelm mode instruction (only if not panic attack)
  if (isCryingOrOverwhelmed && !isPanicAttack) {
    context += `USER STATE: User is crying or overwhelmed. Prioritize presence. 1-2 sentences max. No questions unless user initiates. No action suggestions.\n\n`;
  }

  // Build prompt with system instructions
  console.log('[AI] [PROMPT] Using system prompt: "HUMAN FRIEND MODE - Caring, warm, protective"');
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
  userId?: string,
  detectedLang?: 'en' // Optional: detected language from STT (always 'en' - English only)
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

  // Reply language is always English (Hindi support removed)
  const replyLanguage: 'english' = 'english';
  console.log('[AI] [LANGUAGE] Reply language: English (always)');
  console.log('[AI] [LANGUAGE] Latest user message (first 60 chars):', message.substring(0, 60));
  
  // Check for crying/overwhelm mode
  const isCryingOrOverwhelmed = detectCryingOrOverwhelm(message);

  // Check for panic attack
  const isPanicAttack = detectPanicAttack(message);

  const provider = getAIProvider();

  if (provider === 'ollama') {
    return await getAIPanicResponseOllama(message, history, userContext, conversationId, userId, detectedLang);
  }

  // Default to OpenAI
  // Build input string from system prompt and conversation history
  console.log('[AI] [PROMPT] Using system prompt: "HUMAN FRIEND MODE - Caring, warm, protective"');
  let inputText = `System: ${SYSTEM_PROMPT}\n\n`;
  
  // Add panic attack instruction if detected
  if (isPanicAttack) {
    inputText += `PANIC ATTACK DETECTED: User is having a panic attack. Respond in 2-4 sentences: 1) Confirm + reassure, 2) Ask ONE simple safety/body question, 3) Offer ONE tiny grounding action only if needed. Keep it calm, human, not robotic.\n\n`;
  }
  
  // Add crying/overwhelm mode instruction (only if not panic attack)
  if (isCryingOrOverwhelmed && !isPanicAttack) {
    inputText += `USER STATE: User is crying or overwhelmed. Prioritize presence. 1-2 sentences max. No questions unless user initiates. No action suggestions.\n\n`;
  }
  
  // No language instruction needed - always English
  
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
    
    // Check if user asked about history and inject evidence pack
    const userAskedAboutHistory = message && (
      message.toLowerCase().includes('remember') ||
      message.toLowerCase().includes('do you know') ||
      message.toLowerCase().includes('have i told you') ||
      message.toLowerCase().includes('did i mention') ||
      message.toLowerCase().includes('did i write') ||
      message.toLowerCase().includes('post') ||
      message.toLowerCase().includes('posted') ||
      message.toLowerCase().includes('journal') ||
      message.toLowerCase().includes('record') ||
      message.toLowerCase().includes('check') ||
      message.toLowerCase().includes('lately') ||
      message.toLowerCase().includes('recently') ||
      message.toLowerCase().includes('last time') ||
      message.toLowerCase().includes('before') ||
      message.toLowerCase().includes('earlier') ||
      message.toLowerCase().includes('see if') ||
      message.toLowerCase().includes('see whether') ||
      /did i (post|write|mention|say)/i.test(message) ||
      /what did i (post|write|say)/i.test(message) ||
      /(see|check|look).*(post|journal|record)/i.test(message)
    );
    
    if (userAskedAboutHistory) {
      const evidencePack = buildHistoryEvidencePack(userContext.recentPosts, message);
      inputText += evidencePack + "\n\n";
      console.log('[AI] [HISTORY] User asked about history - injected evidence pack');
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

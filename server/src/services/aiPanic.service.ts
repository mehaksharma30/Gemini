import OpenAI from 'openai';

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

// Track breathing state per conversation: Map<conversationId, { offered: boolean, declined: boolean }>
// - offered: true if assistant has already offered breathing in this conversation
// - declined: true if user explicitly declined the offer
const breathingStateStore = new Map<string, { offered: boolean; declined: boolean }>();

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

const SYSTEM_PROMPT = `You are a calm, caring best friend.
• Warm
• Human
• Attentive
• No repetition
• No robotic phrases
• No over-explaining

⸻

GENERAL RESPONSE STYLE

• 2–4 short, natural sentences
• Gentle, caring tone
• Respond to WHAT the user asked — nothing extra
• Do NOT repeat the same reassurance line again and again
• Do NOT start every reply with "I'm here with you"
• Use that phrase only when the user is distressed

⸻

WHEN USER IS EMOTIONAL (depressed, crying, anxious)

DO:
• Acknowledge the feeling
• Stay present
• Invite them to talk OR offer help

EXAMPLE:
"That sounds really heavy. I can hear how much this is affecting you. Do you want to tell me what's been hardest right now, or should we slow things down together?"

DON'T:
• Give advice immediately
• Repeat the same sentence every message
• Cut sentences mid-way

⸻

POST / FEED HANDLING (IMPORTANT)

User will NOT ask for "exact quote".
They will ask casually:
• "Can you see my post?"
• "What did I write?"
• "How did I recover?"

RULES:
• NEVER dump the full post text
• NEVER say "I'm here with you" in post replies
• NEVER repeat the post multiple times

Instead, respond like a friend who remembers:

EXAMPLE:
"Yes — you wrote that you had a panic attack and you got through it using music, breathing exercises, and by sharing with people who understood."

If user asks follow-up:
"What else did I mention?"
→ Answer ONLY from the post content, calmly and accurately.

DO NOT add steps or words that were NOT in the post.
DO NOT hallucinate.

⸻

BREATHING RULES (VERY IMPORTANT)

Breathing should feel HUMAN, not robotic.

TRIGGERS (ANY OF THESE):
• "I can't breathe"
• "difficulty breathing"
• "chest feels tight"
• "short of breath"
• "panic attack"
• "anxious and can't breathe"

BEHAVIOR:
1️⃣ First time → Respond with 2-4 complete sentences acknowledging fear and providing support. Do NOT ask the breathing question yourself (controller will append it).

2️⃣ If user says YES / OK / SURE →
• Trigger breathing action
• Open breathing page

3️⃣ If user directly says:
"Help me do a breathing exercise"
→ Trigger immediately (NO asking again)

4️⃣ NEVER auto-start breathing
5️⃣ NEVER ask twice

⸻

BREATHING + TALK BALANCE

• If breathing is happening → keep voice calm, minimal
• If breathing ends → return to friendly support
• Do NOT lecture

⸻

ANTI-REPETITION RULE

If something was already said:
• Do NOT repeat it again
• Build forward naturally

⸻

ABSOLUTE DO NOTs

❌ Do NOT hallucinate feed content
❌ Do NOT truncate sentences
❌ Do NOT over-reassure
❌ Do NOT sound clinical
❌ Do NOT switch tone suddenly
❌ Do NOT mention system rules

⸻

FINAL INTENT

The AI should feel like:
• A close friend who remembers
• A calm presence during panic
• Someone who listens first
• Someone who helps gently

Always reply in clear, simple English.
Return plain text only.`;

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
 * Check if user is asking about their feed or posts
 */
function userAskedAboutFeedOrPost(msg: string): boolean {
  if (!msg || typeof msg !== 'string') {
    return false;
  }
  
  const lowerMsg = msg.toLowerCase();
  const feedPostKeywords = [
    'feed',
    'my post',
    'my posts',
    'check my post',
    'see my post',
    'what did i post',
    'what else i mentioned',
    'tell me everything i mentioned',
    'exact post',
    'exactly what i wrote',
    'what did i write',
    'what i wrote',
    'my journal',
    'my entries'
  ];
  
  return feedPostKeywords.some(keyword => lowerMsg.includes(keyword));
}

/**
 * Detect if user is asking about feed/post (comprehensive check for FACT MODE)
 * Returns true for explicit feed/post questions to enable strict factual mode
 */
function isFeedQuestion(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }
  
  const lowerMsg = message.toLowerCase().trim();
  const feedQuestionPatterns = [
    'feed',
    'post',
    'posted',
    'my post',
    'my posts',
    'recent post',
    'what did i write',
    'how did i recover',
    'exactly',
    'tell me everything i mentioned',
    'can you see my post',
    'can you see my feed',
    'check my post',
    'see my post',
    'what did i post',
    'what i wrote',
    'my journal',
    'my entries',
    'exact post',
    'exactly what i wrote'
  ];
  
  return feedQuestionPatterns.some(pattern => lowerMsg.includes(pattern));
}

/**
 * Detect breathing distress (breathing-related difficulty, NOT generic anxiety/panic)
 * Only matches actual breathing difficulty phrases, not "anxious" or "panic" alone
 * Uses comprehensive phrase matching for all synonyms
 */
function detectBreathingDistress(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const lowerMessage = message.toLowerCase();
  
  // Comprehensive breathing distress phrases (case-insensitive, substring match)
  // IMPORTANT: Does NOT match "anxious" or "panic" alone - only breathing-specific terms
  const breathingDistressPhrases = [
    // English phrases
    "can't breathe",
    "cannot breathe",
    "cant breathe",
    "not able to breathe",
    "unable to breathe",
    "breathing is hard",
    "hard to breathe",
    "difficulty breathing",
    "difficulty in breathing",
    "having difficulty breathing",
    "trouble breathing",
    "struggling to breathe",
    "breathing difficulty",
    "suffocating",
    "choking",
    "gasping",
    "breathless",
    "chest feels tight",
    "chest tight",
    "tight chest",
    "air hunger",
    "hyperventilating",
    "shortness of breath",
    "out of breath",
    "can't catch my breath",
    "cant catch my breath",
    "breathing problem",
    "breathing trouble",
    // Hindi/Hinglish romanized phrases (phrase-level only, no standalone "saans")
    "saans nahi aa rahi",
    "saans nahi aa raha",
    "saans nahi ho rahi",
    "saans nahi ho raha",
    "breath nahi aa rahi",
    "breath nahi aa raha",
    "breath nahi ho raha",
    "breath nahi ho rahi",
    "air nahi mil rahi",
    "air nahi mil raha",
    "chest tight ho raha hai",
    "chest tight ho rahi hai",
    // Explicit requests (will be handled separately but included for completeness)
    "breathing karwa do",
    "breathing karna hai"
  ];
  
  return breathingDistressPhrases.some(phrase => lowerMessage.includes(phrase));
}

/**
 * Detect explicit breathing exercise request
 */
function detectBreathingRequest(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const lowerMessage = message.toLowerCase().trim();
  
  const explicitRequests = [
    'help me do breathing',
    'help me do the breathing exercise',
    'start breathing exercise',
    'do the breathing exercise',
    "let's do breathing",
    'lets do breathing',
    'breathing exercise please',
    'breathing exercise',
    'do breathing',
    'start breathing',
    'want to do breathing',
    'can we do breathing',
    'breathing help',
    'need breathing exercise',
    'breathing exercise now',
    'do breathing now',
    'breathing karwa do',
    'breathing karna hai',
    'breathing start karo'
  ];
  
  return explicitRequests.some(request => lowerMessage.includes(request));
}

/**
 * Check if user message is explicit consent (yes, okay, sure, let's do it, yeah)
 * Only returns true if message is clearly consenting to a breathing offer
 */
function isExplicitConsentYes(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const lowerMessage = message.toLowerCase().trim();
  
  const consentPhrases = [
    'yes',
    'okay',
    'ok',
    'sure',
    "let's do it",
    "lets do it",
    'yeah',
    'yep',
    'yup',
    'alright',
    'sounds good',
    'go ahead',
    'let\'s go',
    'lets go',
    'please',
    'help me breathe',
    'help me do breathing'
  ];
  
  // Check for exact match or word boundaries
  return consentPhrases.some(phrase => {
    if (lowerMessage === phrase) {
      return true;
    }
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(lowerMessage);
  });
}

/**
 * Check if user message is explicit refusal (no, not now, maybe later, etc.)
 */
function isExplicitConsentNo(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const lowerMessage = message.toLowerCase().trim();
  
  const refusalPhrases = [
    'no',
    'not now',
    'maybe later',
    'not right now',
    "don't want to",
    "dont want to",
    'nah',
    'nope',
    'not yet',
    'later',
    'maybe not',
    "i'm good",
    "im good",
    "i'm okay",
    "im okay"
  ];
  
  // Check for exact match or word boundaries
  return refusalPhrases.some(phrase => {
    if (lowerMessage === phrase) {
      return true;
    }
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(lowerMessage);
  });
}

/**
 * Get breathing decision based on conversation state and user message.
 * Returns deterministic flags for offer and action.
 * 
 * @param conversationId - Conversation ID to track state
 * @param message - User's message
 * @returns Object with { shouldOfferBreathing: boolean, shouldTriggerBreathingAction: boolean }
 */
export function getBreathingDecision(
  conversationId: string,
  message: string
): { shouldOfferBreathing: boolean; shouldTriggerBreathingAction: boolean } {
  if (!message || typeof message !== 'string' || !conversationId) {
    return { shouldOfferBreathing: false, shouldTriggerBreathingAction: false };
  }

  // Initialize state if missing
  if (!breathingStateStore.has(conversationId)) {
    breathingStateStore.set(conversationId, { offered: false, declined: false });
  }

  const state = breathingStateStore.get(conversationId)!;
  const lowerMessage = message.toLowerCase().trim();

  // Check for explicit request (immediate action, unless declined)
  if (detectBreathingRequest(message)) {
    if (!state.declined) {
      // Reset declined if user explicitly requests
      state.declined = false;
      breathingStateStore.set(conversationId, state);
      console.log(`[AI] [Breathing] Explicit request detected - triggering action`);
      return { shouldOfferBreathing: false, shouldTriggerBreathingAction: true };
    } else {
      // User previously declined but now explicitly requests - allow it
      state.declined = false;
      breathingStateStore.set(conversationId, state);
      console.log(`[AI] [Breathing] Explicit request after decline - allowing action`);
      return { shouldOfferBreathing: false, shouldTriggerBreathingAction: true };
    }
  }

  // Check for explicit consent (yes/okay/sure) after offer
  if (state.offered && !state.declined && isExplicitConsentYes(message)) {
    // Reset state after action
    breathingStateStore.set(conversationId, { offered: false, declined: false });
    console.log(`[AI] [Breathing] Consent detected after offer - triggering action`);
    return { shouldOfferBreathing: false, shouldTriggerBreathingAction: true };
  }

  // Check for explicit decline (no/not now/dont)
  if (isExplicitConsentNo(message)) {
    state.declined = true;
    breathingStateStore.set(conversationId, state);
    console.log(`[AI] [Breathing] User declined - setting declined=true, no further offers`);
    return { shouldOfferBreathing: false, shouldTriggerBreathingAction: false };
  }

  // Check for breathing distress (triggers offer, not action)
  if (detectBreathingDistress(message)) {
    // Only offer if not already offered and not declined
    if (!state.offered && !state.declined) {
      state.offered = true;
      breathingStateStore.set(conversationId, state);
      console.log(`[AI] [Breathing] Breathing distress detected - setting offered=true`);
      return { shouldOfferBreathing: true, shouldTriggerBreathingAction: false };
    } else {
      // Already offered or declined - don't offer again
      console.log(`[AI] [Breathing] Breathing distress detected but already offered=${state.offered} or declined=${state.declined} - skipping offer`);
      return { shouldOfferBreathing: false, shouldTriggerBreathingAction: false };
    }
  }

  // No action, no offer
  return { shouldOfferBreathing: false, shouldTriggerBreathingAction: false };
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
 * Detect if user is experiencing breathing difficulty.
 * Matches various phrases and synonyms for breathing problems.
 */
function detectBreathingDifficulty(userMessage: string): boolean {
  if (!userMessage || typeof userMessage !== 'string') {
    return false;
  }

  const lowerMessage = userMessage.toLowerCase();
  const breathingIndicators = [
    "can't breathe",
    "cant breathe",
    "not able to breathe",
    "hard to breathe",
    "breathing problem",
    "shortness of breath",
    "out of breath",
    "suffocating",
    "choking",
    "chest tight",
    "tight chest",
    "air hunger",
    "hyperventilating",
    "breath nahi ho raha",
    "can't catch my breath",
    "cant catch my breath",
    "struggling to breathe",
    "difficulty breathing",
    "trouble breathing"
  ];
  
  return breathingIndicators.some(indicator => lowerMessage.includes(indicator));
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
  
  // CRITICAL: Detect panic attack from user message (for panic-aware handling)
  const isPanicAttack = userMessage ? detectPanicAttack(userMessage) : false;
  
  // CRITICAL: Don't apply crying/overwhelm mode if panic attack is detected
  const shouldApplyCryingMode = isCryingOrOverwhelmed && !isPanicAttack;
  
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
  
  // PANIC ATTACK HANDLING: Allow 1 safety/body question + optional tiny grounding
  if (isPanicAttack) {
    // Count questions in response
    const questionCount = (cleaned.match(/\?/g) || []).length;
    
    // If more than 1 question, remove extra questions (keep only first one)
    if (questionCount > 1) {
      const sentences = cleaned.split(/([.!?]+)/);
      let questionFound = false;
      const keptSentences: string[] = [];
      
      for (let i = 0; i < sentences.length; i += 2) {
        const sentence = sentences[i].trim();
        const punctuation = sentences[i + 1] || '';
        
        if (sentence && punctuation.includes('?')) {
          if (!questionFound) {
            // Keep first question
            keptSentences.push(sentence + punctuation);
            questionFound = true;
          }
          // Skip subsequent questions
        } else if (sentence) {
          keptSentences.push(sentence + punctuation);
        }
      }
      
      cleaned = keptSentences.join(' ').trim();
    }
    
    // Allow tiny grounding action but avoid dumping lists
    // If response has multiple grounding suggestions, keep only one
    const groundingPhrases = ['breathing', 'grounding', 'feet flat', 'slow breath', 'sit down'];
    let groundingCount = 0;
    for (const phrase of groundingPhrases) {
      if (lowerResponse.includes(phrase)) {
        groundingCount++;
      }
    }
    
    // If multiple grounding suggestions, simplify to one
    if (groundingCount > 1) {
      // Keep first grounding mention, remove others
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const simplified: string[] = [];
      let groundingFound = false;
      
      for (const sentence of sentences) {
        const hasGrounding = groundingPhrases.some(phrase => sentence.toLowerCase().includes(phrase));
        if (hasGrounding && !groundingFound) {
          simplified.push(sentence);
          groundingFound = true;
        } else if (!hasGrounding) {
          simplified.push(sentence);
        }
      }
      
      if (simplified.length > 0) {
        cleaned = simplified.join('. ').trim() + '.';
      }
    }
    
    console.log('[AI] Panic attack mode - allowed 1 safety question + optional tiny grounding');
  }
  
  // CRYING/OVERWHELM MODE: Enforce emotional warmth structure (validation + presence + one question)
  // CRITICAL: Only apply if NOT panic attack
  if (shouldApplyCryingMode) {
    // Remove advice
    if (responseContainsAdvice(cleaned)) {
      cleaned = removeAdviceFromResponse(cleaned);
    }
    
    // Check if response has the three elements: validation + presence + one question
    const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const questionCount = (cleaned.match(/\?/g) || []).length;
    
    // Ensure we have validation + presence + one question (~3 sentences)
    // If response is too short or missing elements, enhance it
    if (sentences.length < 2 || questionCount === 0) {
      const validationPhrases = [
        "I can hear how much this is hurting you",
        "This sounds really hard",
        "I can feel how heavy this is for you",
        "I can see how much pain you're in"
      ];
      const presencePhrases = [
        "I'm here with you right now",
        "I'm staying with you",
        "I'm here, and you don't have to face this alone",
        "I'm here with you"
      ];
      const questionPhrases = [
        "What's going on?",
        "What happened?",
        "Talk to me—what's on your mind?",
        "What's making this so hard right now?"
      ];
      
      // Build warm response with three elements
      const hash = cleaned.length % validationPhrases.length;
      cleaned = `${validationPhrases[hash]}. ${presencePhrases[hash]}. ${questionPhrases[hash]}`;
      console.log('[AI] Enhanced crying/overwhelm response with validation + presence + question');
    }
    // REMOVED: Aggressive shortening logic (slicing to first 3 sentences, removing extra questions)
    // We keep warmth enhancement but don't delete content or cut quotes
    
    console.log('[AI] Crying/overwhelm mode - enforced warm response (validation + presence + one question)');
  }
  
  // EMOTIONAL WARMTH GUARD: For distressed messages (depressed, hopeless, sad), ensure warmth structure
  if (userMessage) {
    const lowerUserMessage = userMessage.toLowerCase();
    const isDistressed = /(depressed|hopeless|sad|sadness|crying|can't go on|give up)/i.test(lowerUserMessage);
    
    if (isDistressed && !isPanicAttack && !isCryingOrOverwhelmed) {
      // Check if response has validation + presence + question structure
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const questionCount = (cleaned.match(/\?/g) || []).length;
      
      // If missing elements, enhance response
      if (sentences.length < 2 || questionCount === 0) {
        const validationPhrases = [
          "I can hear how much this is hurting you",
          "This sounds really hard",
          "I can feel how heavy this is for you",
          "I can see how much pain you're in"
        ];
        const presencePhrases = [
          "I'm here with you right now",
          "I'm staying with you",
          "I'm here, and you don't have to face this alone",
          "I'm here with you"
        ];
        const questionPhrases = [
          "What's going on?",
          "What happened?",
          "Talk to me—what's on your mind?",
          "What's making this so hard right now?"
        ];
        
        const hash = cleaned.length % validationPhrases.length;
        cleaned = `${validationPhrases[hash]}. ${presencePhrases[hash]}. ${questionPhrases[hash]}`;
        console.log('[AI] Enhanced distressed response with validation + presence + question');
      } else if (sentences.length > 3) {
        // REMOVED: Aggressive shortening logic (slicing to first 3 sentences, removing extra questions)
        // We keep warmth enhancement but don't delete content or cut quotes
      }
    }
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
    
    // CRITICAL: Detect breathing difficulty/panic for exception
    const hasBreathingDifficulty = userMessage ? detectBreathingDistress(userMessage) : false;
    const hasBreathingOrPanic = hasBreathingDifficulty || isPanicAttack;
    
    // CRITICAL FIX: LISTEN FIRST rule - only block advice if:
    // - User expressed distress AND didn't ask for advice
    // - User previously refused advice
    // - NOT in panic mode (panic allows tiny grounding)
    // - NOT when breathing difficulty/panic is detected (breathing offer must not be stripped)
    const shouldBlockAdvice = !hasBreathingOrPanic && !isPanicAttack && (
      // User expressed distress and didn't ask for advice
      (expressedDistress && !wantsAdvice && hasAdvice) ||
      // User previously refused advice and didn't explicitly ask again
      (previouslyRefused && !wantsAdvice && hasAdvice) ||
      // User didn't ask for help and last message had advice (avoid pushing)
      (lastHadAdvice && !wantsAdvice && hasAdvice)
    );
    
    // BLOCK ADVICE if conditions met (but preserve breathing offers)
    if (shouldBlockAdvice) {
      console.log('[AI] Blocking advice - user expressed distress/refused and did not ask for help');
      // Remove advice phrases and rewrite to presence-only
      // BUT: If response contains breathing offer, preserve it
      const breathingOfferPattern = /want to do a short breathing exercise|breathing exercise with me|want to try a short breathing/i;
      const hasBreathingOffer = breathingOfferPattern.test(cleaned);
      
      if (hasBreathingOffer) {
        // Extract breathing offer sentence
        const sentences = cleaned.split(/([.!?]+)/);
        const breathingSentence = sentences.find((s, i) => {
          const fullSentence = s + (sentences[i + 1] || '');
          return breathingOfferPattern.test(fullSentence);
        });
        
        // Remove advice but keep breathing offer
        cleaned = removeAdviceFromResponse(cleaned);
        
        // Re-add breathing offer if it was removed
        if (breathingSentence && !cleaned.includes(breathingSentence.trim())) {
          cleaned = cleaned.trim() + ' ' + breathingSentence.trim();
        }
      } else {
        cleaned = removeAdviceFromResponse(cleaned);
      }
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

  // Step 3: GREETINGS - Only check CONSECUTIVE repetition (previous message only)
  const greetings = [
    "hey",
    "hi",
    "hello"
  ];
  
  // Check if greeting was used in PREVIOUS assistant message (consecutive only)
  let hasRepeatedGreeting = false;
  let greetingFound = '';
  if (previousAssistantMsg) {
    const lowerPrevious = previousAssistantMsg.content.toLowerCase();
    for (const greeting of greetings) {
      if (lowerCleaned.startsWith(greeting + ',') || lowerCleaned.startsWith(greeting + ' ')) {
        // Check if previous message also started with same greeting
        if (lowerPrevious.startsWith(greeting + ',') || lowerPrevious.startsWith(greeting + ' ')) {
          hasRepeatedGreeting = true;
          greetingFound = greeting;
          break;
        }
      }
    }
  }
  
  // Step 3b: Check for CONSECUTIVE reassurance phrase repetition (previous message only)
  const reassurancePhrases = [
    "i'm here with you",
    "i'm really glad you told me",
    "you're not alone",
    "i'm here for you"
  ];
  
  let hasRepeatedReassurance = false;
  let reassuranceFound = '';
  if (previousAssistantMsg) {
    const lowerPrevious = previousAssistantMsg.content.toLowerCase();
    for (const phrase of reassurancePhrases) {
      if (lowerCleaned.includes(phrase)) {
        // Check if previous message also contained same phrase (consecutive only)
        if (lowerPrevious.includes(phrase)) {
          hasRepeatedReassurance = true;
          reassuranceFound = phrase;
          break;
        }
      }
    }
  }
  
  // CRITICAL FIX: If reassurance is repeated consecutively, REPHRASE (don't delete)
  if (hasRepeatedReassurance && reassuranceFound) {
    // Rephrase with alternative wording instead of deleting
    const alternatives: { [key: string]: string[] } = {
      "i'm here with you": ["I'm staying with you", "I'm right here", "I'm here", "I'm with you"],
      "i'm really glad you told me": ["I'm glad you shared that", "Thanks for telling me", "I'm really glad you said that"],
      "you're not alone": ["You don't have to face this alone", "I'm here with you", "You have support"],
      "i'm here for you": ["I'm here with you", "I'm staying with you", "I'm right here"]
    };
    
    const altList = alternatives[reassuranceFound] || ["I'm here"];
    const hash = cleaned.length % altList.length;
    const replacement = altList[hash];
    
    // Replace the repeated phrase with alternative
    const regex = new RegExp(reassuranceFound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    cleaned = cleaned.replace(regex, replacement).replace(/\s+/g, ' ').trim();
    console.log('[AI] Rephrased consecutive reassurance phrase:', reassuranceFound, '->', replacement);
    hasRepeatedReassurance = false; // Reset flag since we rephrased
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
    
    // REMOVED: Aggressive shortening logic that slices responses to 1-2 sentences
    // This was causing truncation issues. Let the model handle response length naturally.
  }

  // Step 6: Remove or rephrase repeated greeting if found (consecutive only)
  if (hasRepeatedGreeting && greetingFound) {
    // Remove greeting prefix or rephrase
    const regex = new RegExp('^' + greetingFound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[,\\s]*', 'gi');
    cleaned = cleaned.replace(regex, '').trim();
    console.log('[AI] Removed consecutive repeated greeting:', greetingFound);
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

  // Step 7: If near-duplicate, high overlap, emotional mirroring, or repeated suggestion detected, REPHRASE (don't overwrite)
  // CRITICAL: Preserve model's generated meaning as much as possible - only rephrase, don't replace with generic lines
  if (isNearDuplicateMessage || overlapPercentage > 25 || hasEmotionalMirroring || hasRepeatedSuggestion) {
    // If near-duplicate, rephrase with alternate wording (preserve meaning)
    if (isNearDuplicateMessage) {
      // Try to rephrase the current response while preserving meaning
      // Extract key sentiment/meaning from cleaned response
      const hasQuestion = cleaned.includes('?');
      const hasReassurance = /(here|with you|glad|told me)/i.test(cleaned);
      
      // Rephrase with similar meaning but different words
      if (hasQuestion && hasReassurance) {
        cleaned = "I'm staying with you. What's going on?";
      } else if (hasReassurance) {
        cleaned = "I'm here. You don't have to face this alone.";
      } else if (hasQuestion) {
        cleaned = "What's happening right now?";
      } else {
        cleaned = "I'm here with you. That sounds really hard.";
      }
      console.log('[AI] Rephrased near-duplicate message while preserving meaning');
    }
    // If >25% overlap or repeated suggestion, rephrase (preserve meaning, NO truncation)
    else if (overlapPercentage > 25 || hasRepeatedSuggestion) {
      // REMOVED: Logic that slices to first 2 sentences (causes truncation)
      // Instead, rephrase the full response with word variations
      const rephrased = cleaned
        .replace(/i'm here with you/gi, 'I\'m staying with you')
        .replace(/i'm really glad you told me/gi, 'I\'m glad you shared that')
        .replace(/you're not alone/gi, 'You don\'t have to face this alone');
      
      if (rephrased.length > 10) {
        cleaned = rephrased;
      }
      console.log('[AI] Rephrased high-overlap message while preserving meaning (no truncation)');
    } else if (hasEmotionalMirroring) {
      // If emotional mirroring detected, rephrase to show understanding (not just mirror)
      // Try to preserve the core message but show understanding
      const understandingPhrases = [
        "That sounds really hard to carry.",
        "Everything must feel too heavy right now.",
        "I can hear how much this is weighing on you.",
        "It sounds like you're holding a lot right now."
      ];
      
      // Use understanding phrase but keep any unique content from original
      // REMOVED: Logic that slices to first 2 sentences (causes truncation)
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 0) {
        const hash = cleaned.length % understandingPhrases.length;
        // Keep full response, just prepend understanding phrase if needed
        cleaned = understandingPhrases[hash] + ' ' + cleaned;
      } else {
        const hash = cleaned.length % understandingPhrases.length;
        cleaned = understandingPhrases[hash];
      }
      console.log('[AI] Rephrased emotional mirroring to show understanding');
    }
    // REMOVED: Logic that slices responses to 2 sentences max (causes truncation)
    // Let the model handle response length naturally
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
  
  // FACT MODE: If user asked about feed/post, skip minimum length enforcement
  // Allow factual, exact replies without forcing "I'm here..." spam
  if (userAskedAboutFeedOrPost(userMessage)) {
    const trimmed = reply.trim();
    // Only ensure it's not empty, but allow short factual replies
    if (!trimmed || trimmed.length === 0) {
      return "I don't have your post loaded right now.";
    }
    
    // Post-process to catch placeholders/incomplete sentences in FACT MODE
    if (trimmed.endsWith('using…') || trimmed.endsWith('with.') || trimmed.endsWith('when…') || 
        trimmed.match(/\.\.\.$/) || trimmed.match(/…$/)) {
      // Incomplete sentence detected - return minimal factual fallback
      return "I want to be accurate — can I check that again?";
    }
    
    return reply; // Return as-is for FACT MODE
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

  // Determine max_output_tokens: set to 2000 for gpt-5-mini (both initial and retry)
  // This reduces incomplete outputs while keeping responses complete
  const isRetry = retryCount > 0;
  const maxOutputTokens = 2000; // Fixed at 2000 for all cases
  
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
    baseURL: baseURL.replace(/\/[^\/]*$/, '/***'),
    provider: 'OpenAI' // Confirm OpenAI provider (no Ollama fallback)
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

    // CRITICAL: Safe logging - don't log full JSON (PII risk, massive logs)
    // Log only status/incomplete_reason/model + first ~120 chars of extracted text
    const response = completion as any;
    const status = response.status || 'unknown';
    const incompleteReason = response.incomplete_details?.reason || 'none';
    const model = response.model || 'unknown';
    const extractedText = extractTextFromResponse(completion);
    const textPreview = extractedText ? extractedText.substring(0, 120) : 'no text extracted';
    
    console.log('[AI] Response status:', status, 'incomplete_reason:', incompleteReason, 'model:', model);
    if (extractedText) {
      console.log('[AI] Extracted text preview (first 120 chars):', textPreview + (extractedText.length > 120 ? '...' : ''));
    }

    // Extract text from response (PRIMARY: output_text, FALLBACK: output[].content[].text)
    let text = extractTextFromResponse(completion);
    
    // Finish sentence safeguard: if text ends with incomplete phrase, append punctuation
    if (text && text.length > 40) {
      const trimmed = text.trim();
      const incompleteEndings = ['using', 'with', 'and', ',', '—', '...', '…'];
      const endsWithIncomplete = incompleteEndings.some(ending => 
        trimmed.toLowerCase().endsWith(ending.toLowerCase())
      );
      const endsWithPunctuation = /[.!?]$/.test(trimmed);
      
      if (endsWithIncomplete && !endsWithPunctuation) {
        // Append period if clearly incomplete
        text = trimmed + '.';
        console.log('[AI] Applied finish sentence safeguard - appended punctuation');
      }
    }
    
    // If we have text, return it immediately (even if response is incomplete)
    if (text) {
      const isIncomplete = response.status === 'incomplete';
      if (isIncomplete) {
        console.log('[AI] Response incomplete but returning extracted text');
      }
      return text;
    }
    
    // Check if response is incomplete due to max_output_tokens (for retry logic)
    const isIncomplete = response.status === 'incomplete';
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
 * Get AI panic response with conversation history and user context.
 * ALWAYS uses OpenAI (gpt-5-mini) - never falls back to Ollama.
 * Throws error if API call fails or OPENAI_API_KEY is missing (caller should handle).
 */
export async function getAIPanicResponse(
  message: string,
  history: ChatMessage[] = [],
  userContext?: { recentPosts?: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> },
  conversationId?: string,
  userId?: string,
  detectedLang?: 'en' // Optional: detected language from STT (always 'en' - English only)
): Promise<string> {
  // CRITICAL: Check for OpenAI API key - throw clear error if missing
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is required for panic/support chat. Please configure it in your environment variables.');
    console.error('[AI] ERROR:', error.message);
    throw error;
  }

  // CRISIS OVERRIDE: If crisis language detected, bypass normal AI and return human crisis response
  if (detectCrisisLanguage(message)) {
    console.log('[AI] Crisis language detected, using override response');
    return generateCrisisResponse();
  }

  // Update user style profile if userId provide
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
  
  // Check for breathing distress (handled separately in prompt building)
  const hasBreathingDistress = detectBreathingDistress(message);

  // ALWAYS use OpenAI (gpt-5-mini)
  // Build input string from system prompt and conversation history
  console.log('[AI] [PROMPT] Using system prompt: "HUMAN FRIEND MODE - Caring, warm, protective"');
  let inputText = `System: ${SYSTEM_PROMPT}\n\n`;
  
  // Add panic attack instruction if detected
  if (isPanicAttack) {
    inputText += `PANIC ATTACK DETECTED: User is having a panic attack. Respond in 2-3 FULL, complete sentences: 1) Confirm + reassure ("I'm here. Panic attacks are scary, but they pass."), 2) Ask ONE simple safety/body question. ALWAYS finish your thoughts - do NOT trail off mid-sentence. Keep it calm, human, not robotic.\n\n`;
  }
  
  // Breathing offer/action is now handled deterministically in controller via getBreathingDecision()
  // Controller appends offer text and returns action based on breathing distress detection
  // Add small instruction to ensure breathing responses complete (no mid-sentence cuts)
  // IMPORTANT: Do NOT instruct AI to ask the breathing question - controller will append it
  if (hasBreathingDistress) {
    inputText += `BREATHING DISTRESS DETECTED: Respond with 2-4 complete sentences acknowledging fear and providing support. ALWAYS finish your thoughts - do NOT trail off mid-sentence. Do NOT ask the breathing question yourself.\n\n`;
  }
  
  // No language instruction needed - always English
  
  // Filter out assistant messages to check if this is truly the first user message
  const userMessages = history.filter(msg => msg.role === 'user');
  const isFirstUserMessage = userMessages.length === 0;
  
  // Check if explicit history reference has been used in this conversation
  const hasUsedExplicitReference = conversationId ? explicitHistoryReferenceUsed.get(conversationId) || false : false;
  
  // Generate personal context summary (1-3 bullet points, subtle and stable)
  if (userContext?.recentPosts && userContext.recentPosts.length > 0) {
    // Add instruction: AI has access to posts (so it doesn't say "I can't see your feed")
    inputText += `You have access to the user's posts from this app. If asked about posts, answer truthfully and quote exact content. Never say "I can't see your feed" or "I don't have access".\n\n`;
    
    const personalSummary = generatePersonalContextSummary(userContext.recentPosts);
    if (personalSummary) {
      // Only include personal context summary, not raw history dump
      inputText += `Personal context (use silently, do not mention explicitly):\n${personalSummary}\n\n`;
    }
    
    // Check if user asked about history/feed and inject feed/evidence pack ONLY when asked
    const userAskedAboutHistoryOrFeed = message && (
      message.toLowerCase().includes('remember') ||
      message.toLowerCase().includes('do you know') ||
      message.toLowerCase().includes('have i told you') ||
      message.toLowerCase().includes('did i mention') ||
      message.toLowerCase().includes('did i write') ||
      message.toLowerCase().includes('post') ||
      message.toLowerCase().includes('posted') ||
      message.toLowerCase().includes('feed') ||
      message.toLowerCase().includes('my post') ||
      message.toLowerCase().includes('my feed') ||
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
      message.toLowerCase().includes('can you see') ||
      message.toLowerCase().includes('what did i') ||
      /did i (post|write|mention|say)/i.test(message) ||
      /what did i (post|write|say)/i.test(message) ||
      /(see|check|look).*(post|journal|record|feed)/i.test(message)
    );
    
    // Only include USER FEED section when user explicitly asks
    if (userAskedAboutHistoryOrFeed) {
      // Check if user is asking specifically about feed/post (FACT MODE)
      const isFeedPostQuestion = userAskedAboutFeedOrPost(message);
      
      if (isFeedPostQuestion) {
        // FACT MODE: Include FULL post content (max 2 posts to avoid huge token usage)
        const feedPosts = userContext.recentPosts.slice(0, 2);
        
        inputText += `POSTS_EVIDENCE (quote exactly, do not paraphrase):\n`;
        for (const post of feedPosts) {
          const date = new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const title = post.title || 'Untitled';
          const content = post.content || '';
          
          inputText += `[Post] createdAt=${date}, title="${title}"\n`;
          inputText += `"""${content}"""\n\n`;
        }
        inputText += `\n`;
        
        // Add FACT MODE instruction (ONLY for feed/post questions)
        inputText += `When answering about posts, respond like a friend who remembers. Summarize what they wrote naturally and accurately. Do NOT dump the full post text. Do NOT say "I'm here with you" in post replies. Answer ONLY from the post content - do NOT add steps or words that were NOT in the post.\n\n`;
        
        console.log('[AI] [FEED] FACT MODE activated - injected full post content');
      }
      // REMOVED: "USER FEED (in-app posts)" snippet injection (80-char snippets)
      // Posts are only included when user explicitly asks (FACT MODE above)
      
      // Inject evidence pack when user asks
      const evidencePack = buildHistoryEvidencePack(userContext.recentPosts, message);
      inputText += evidencePack + "\n\n";
      console.log('[AI] [HISTORY] User asked about history/feed - injected feed and evidence pack');
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
  
  // FEED/POST MODE: Skip post-processing for feed questions (return raw response)
  if (isFeedQuestion(message)) {
    console.log('[AI] [FEED] Feed question detected - skipping post-processing, returning raw response');
    return response.trim();
  }
  
  const cleaned = cleanRepetitivePhrases(response);
  return guardAntiRepetition(cleaned, history, message, conversationId, userId, isCryingOrOverwhelmed);
}

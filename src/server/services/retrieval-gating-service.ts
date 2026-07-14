/**
 * Retrieval Gating Service — P0 Query Gate
 *
 * Implements deterministic SKIP predicates before any retrieval runs.
 * Returns one of: skip | retrieve | clarify
 *
 * Design contract (from RAG-retrieval-citation-plan):
 * - SKIP first: trimmed-length-0 / punctuation-only / numeric-only /
 *   acknowledgement-greeting from configurable list / slash-command or UI payload
 * - RETRIEVE second: for answerable queries
 * - ASK_CLARIFY third: for ambiguous/underspecified queries
 *
 * Conversation-aware exception: "1" can be meaningful after the assistant
 * presents numbered choices. The gate must inspect recent dialogue before
 * classifying numeric input as noise.
 */

import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RetrievalAction = 'skip' | 'retrieve' | 'clarify';

export type DeterministicReasonCode =
  | 'empty'
  | 'punctuation_only'
  | 'numeric_only'
  | 'acknowledgement'
  | 'greeting'
  | 'emoji_only'
  | 'ui_control';

export type SemanticReasonCode =
  | 'answerable'
  | 'underspecified'
  | 'out_of_scope'
  | 'adversarial';

export type ReasonCode = DeterministicReasonCode | SemanticReasonCode;

export interface RetrievalGateDecision {
  action: RetrievalAction;
  reasonCode: ReasonCode;
  effectiveQuery: string;
  requiredSlots?: string[];
  /** Confidence that this is an answerable query (0-1), null for skip */
  confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Deterministic skip patterns
// ---------------------------------------------------------------------------

/** Acknowledgement / greeting words that should never trigger retrieval */
const ACKNOWLEDGEMENT_WORDS = new Set([
  '好的', '好的。', '好的！', '好的，', '嗯', '嗯嗯', '嗯嗯嗯',
  '谢谢', '谢谢！', '谢谢。', '谢谢您', '多谢',
  '确认', '确认。', '确认！', '收到', '收到。', '收到！',
  '明白', '明白了', '了解', '知道了', '知道了。',
  'ok', 'okay', '好的', 'yep', 'yes', 'yeah',
  '👍', '🙏', '😊', '🙂',
]);

/** Greeting patterns */
const GREETING_PATTERNS = [
  /^你好[吗呀]?$/i,
  /^您好[吗呀]?$/i,
  /^hi/i,
  /^hello/i,
  /^嗨/i,
  /^嗨嗨/i,
  /^hey/i,
  /^在吗/i,
  /^在嘛/i,
];

/** UI control patterns that should be skipped */
const UI_CONTROL_PATTERNS = [
  /^\/[a-z]+/i,   // slash commands like /help, /cancel
  /^{"/,           // JSON payload
  /^\{/,           // JSON-like payload
];

/** Emoji-only pattern: only emoji characters (including numbers in emoji circles) */
const EMOJI_ONLY_PATTERN = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})+$/u;

/** Numeric-only pattern: digits with optional separators/punctuation */
const NUMERIC_ONLY_PATTERN = /^[0-9\s.,+\-()]+$/;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RetrievalGatingService {
  /**
   * Decide whether to retrieve knowledge for the given user message.
   *
   * @param userMessage - Raw user message content
   * @param recentMessages - Recent conversation messages (role + content) for context
   * @param options - Optional override settings
   */
  shouldRetrieve(
    userMessage: string,
    recentMessages: Array<{ role: string; content: string }>,
    options?: { skipDeterministic?: boolean }
  ): RetrievalGateDecision {
    const trimmed = userMessage.trim();

    // 1. Deterministic SKIP predicates
    if (!options?.skipDeterministic) {
      const skipDecision = this.runDeterministicChecks(trimmed, recentMessages);
      if (skipDecision) {
        return skipDecision;
      }
    }

    // 2. Effective query is the trimmed original (query rewrite not yet implemented)
    const effectiveQuery = trimmed;

    // 3. Semantic decision (lightweight heuristics — no LLM call needed for P0)
    const semantic = this.semanticDecision(effectiveQuery);

    return {
      action: semantic.action,
      reasonCode: semantic.reasonCode,
      effectiveQuery,
      requiredSlots: semantic.requiredSlots,
      confidence: semantic.confidence,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Deterministic SKIP checks
  // ---------------------------------------------------------------------------

  private runDeterministicChecks(
    trimmed: string,
    recentMessages: Array<{ role: string; content: string }>
  ): RetrievalGateDecision | null {
    // Empty
    if (trimmed.length === 0) {
      return { action: 'skip', reasonCode: 'empty', effectiveQuery: trimmed };
    }

    // Pure whitespace
    if (!/[^\s]/.test(trimmed)) {
      return { action: 'skip', reasonCode: 'empty', effectiveQuery: trimmed };
    }

    // Punctuation only (with some leniency for natural punctuation)
    if (this.isPunctuationOnly(trimmed)) {
      return { action: 'skip', reasonCode: 'punctuation_only', effectiveQuery: trimmed };
    }

    // UI control payload (slash commands, JSON)
    if (this.isUIControl(trimmed)) {
      return { action: 'skip', reasonCode: 'ui_control', effectiveQuery: trimmed };
    }

    // Emoji only
    if (EMOJI_ONLY_PATTERN.test(trimmed)) {
      return { action: 'skip', reasonCode: 'emoji_only', effectiveQuery: trimmed };
    }

    // Acknowledgement / greeting (checked before numeric-only to avoid false positives)
    if (this.isAcknowledgement(trimmed)) {
      return { action: 'skip', reasonCode: 'acknowledgement', effectiveQuery: trimmed };
    }
    if (this.isGreeting(trimmed)) {
      return { action: 'skip', reasonCode: 'greeting', effectiveQuery: trimmed };
    }

    // Numeric-only EXCEPT when it follows a numbered-choice message from assistant
    if (NUMERIC_ONLY_PATTERN.test(trimmed)) {
      if (!this.isAfterNumberedChoices(recentMessages)) {
        return { action: 'skip', reasonCode: 'numeric_only', effectiveQuery: trimmed };
      }
      // Contextually meaningful numeric input — don't skip, pass through
      logger.agent.debug('[RetrievalGating] Numeric input after numbered choices — not skipping', {
        message: trimmed,
      });
    }

    return null;
  }

  private isPunctuationOnly(text: string): boolean {
    // Allow natural punctuation in context (e.g. "..." after a response)
    // But block if the entire message is just punctuation
    const stripped = text.replace(/[\s，。！？、；：""''（）【】《》.,!?;:'"()\[\]{}]/g, '');
    return stripped.length === 0;
  }

  private isUIControl(text: string): boolean {
    return UI_CONTROL_PATTERNS.some(p => p.test(text.trim()));
  }

  private isAcknowledgement(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    // Direct match
    if (ACKNOWLEDGEMENT_WORDS.has(normalized) || ACKNOWLEDGEMENT_WORDS.has(text.trim())) {
      return true;
    }
    // Normalized match
    if (ACKNOWLEDGEMENT_WORDS.has(normalized)) {
      return true;
    }
    return false;
  }

  private isGreeting(text: string): boolean {
    const trimmed = text.trim();
    return GREETING_PATTERNS.some(p => p.test(trimmed));
  }

  /**
   * Detect if the most recent assistant message presented numbered choices.
   * If so, numeric input is contextually meaningful and should not be skipped.
   */
  private isAfterNumberedChoices(
    recentMessages: Array<{ role: string; content: string }>
  ): boolean {
    // Look at the last 2 messages for context
    const recent = recentMessages.slice(-2);
    for (const msg of recent) {
      if (msg.role === 'assistant') {
        // Pattern: "请选择：1. X  2. Y  3. Z" or "1.xxx 2.yyy" or numbered list
        const hasNumberedOptions =
          /\b[1-9][.、)）]\s*[\u4e00-\u9fa5a-zA-Z]/.test(msg.content) ||
          /(?:^|\n)\s*[1-9][.、)）]/.test(msg.content) ||
          /请选择/.test(msg.content) ||
          /请回复/.test(msg.content) ||
          /选择[\d一二三四五六七八九十]+/.test(msg.content);
        if (hasNumberedOptions) {
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private: Semantic decision
  // ---------------------------------------------------------------------------

  private semanticDecision(
    query: string
  ): {
    action: RetrievalAction;
    reasonCode: SemanticReasonCode;
    requiredSlots?: string[];
    confidence: number;
  } {
    const ql = query.toLowerCase();

    // Out-of-scope: weather, news, unrelated chitchat
    const outOfScopePatterns = [
      /^今天天气/i,
      /天气\s*(怎么样|如何|好吗)/i,
      /^明天天气/i,
      /新闻/i,
      /股票/i,
    ];
    if (outOfScopePatterns.some(p => p.test(ql))) {
      return { action: 'retrieve', reasonCode: 'out_of_scope', confidence: 0.2 };
    }

    // Adversarial / prompt injection attempts
    const adversarialPatterns = [
      /^忽略[规则]?/i,
      /忽略以上/i,
      /forget everything/i,
      /disregard all/i,
      /你是一个.*退款/i,
    ];
    if (adversarialPatterns.some(p => p.test(ql))) {
      return { action: 'retrieve', reasonCode: 'adversarial', confidence: 0 };
    }

    // Short refund/product keywords — retrieve with low confidence;
// we don't "clarify" because a real customer saying "退款" is meaningful
// even if it's vague. The orchestrator's evidence grading will suppress
// low-quality citations. Must run BEFORE the generic length check below.
    if (['退款', '退货', '换货', '尺码', '尺寸', '价格', '优惠'].includes(ql)) {
      return {
        action: 'retrieve',
        reasonCode: 'underspecified',
        requiredSlots: ['具体需求'],
        confidence: 0.4,
      };
    }

    // Underspecified: too short or vague (after keyword check so known
    // product/refund terms aren't trapped here)
    if (query.length <= 3 && !NUMERIC_ONLY_PATTERN.test(query)) {
      return {
        action: 'clarify',
        reasonCode: 'underspecified',
        requiredSlots: ['具体问题'],
        confidence: 0.3,
      };
    }

    // Default: treat as answerable query
    return { action: 'retrieve', reasonCode: 'answerable', confidence: 0.8 };
  }
}

// Singleton
let instance: RetrievalGatingService | null = null;

export function getRetrievalGatingService(): RetrievalGatingService {
  if (!instance) {
    instance = new RetrievalGatingService();
  }
  return instance;
}

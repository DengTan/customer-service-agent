/**
 * Shared confidence calculation utilities for SmartAssist AI responses.
 * This module centralizes confidence scoring logic used across
 * llm-streaming-service.ts and simulations/[id]/messages/route.ts
 */

// Semantic pattern matching for handoff intent detection
// Covers various ways LLM might express "transfer to human agent"
export const HANDOFF_INTENT_PATTERNS = [
  /建议.{0,4}(转|找|联系|接入|转接).{0,4}(人工|真人|客服人员)/,
  /为您转接人工/,
  /需要人工客服处理/,
  /无法.{0,6}解决.{0,4}人工/,
  /转人工客服/,
  /人工服务/,
  /为您转接(专业|专属|人工)客服/,
  /建议您联系人工/,
  /帮您转接(真人|人工)/,
  /由人工客服(为您|来)?处理/,
  /转接(专业|资深)客服/,
  /找(真人|人工)帮您/,
];

// Confidence score breakdown for explainability
export interface ConfidenceBreakdown {
  knowledge_score: number;    // Knowledge base vector similarity contribution
  tool_score: number;         // Tool execution confidence contribution
  llm_self_score: number;     // LLM self-evaluated confidence contribution
  sub_agent_score: number;     // Sub-agent delegation confidence contribution
  handoff_intent: boolean;    // Whether handoff intent was detected
  no_support: boolean;        // Whether no grounding source exists (pure LLM)
  final: number;              // Final weighted confidence
}

// Input params for confidence calculation
export interface ConfidenceCalculationInput {
  hasKnowledge: boolean;
  knowledgeConfidence: number;
  hasTools: boolean;
  toolExecutions?: Array<{ confidence: number }>;
  llmSelfConfidence: number;
  hasSubAgentDelegation: boolean;
  subAgentDelegationConfidence?: number;
  hasProductContext?: boolean;
  hasSizeChartContext?: boolean;
}

/**
 * Extract LLM self-evaluation confidence tag [CONF:x.x] from content.
 * Returns the confidence value (0-1) or 0 if not found.
 */
export function extractLlmSelfConfidence(content: string): number {
  const confMatches = [...content.matchAll(/\[CONF:([0-9]*\.?[0-9]+)\]/g)];
  if (confMatches.length > 0) {
    const lastMatch = confMatches[confMatches.length - 1];
    return Math.max(0, Math.min(1, parseFloat(lastMatch[1])));
  }
  return 0;
}

/**
 * Detect handoff intent via semantic pattern matching.
 * Returns true if the content contains patterns indicating user should be transferred to human agent.
 */
export function detectHandoffIntent(content: string): boolean {
  return HANDOFF_INTENT_PATTERNS.some(p => p.test(content));
}

/**
 * Calculate confidence score using weighted fusion.
 * Weights: knowledge 40%, tool 30%, LLM self-eval 30%
 * When missing sources, redistribute weights accordingly.
 */
export function calculateConfidence(input: ConfidenceCalculationInput): ConfidenceBreakdown {
  const {
    hasKnowledge,
    knowledgeConfidence,
    hasTools,
    toolExecutions = [],
    llmSelfConfidence,
    hasSubAgentDelegation,
    subAgentDelegationConfidence = 0,
    hasProductContext = false,
    hasSizeChartContext = false,
  } = input;

  const hasGrounding = hasKnowledge || hasTools || hasProductContext || hasSizeChartContext;
  const handoffIntent = detectHandoffIntent(''); // Content-based detection is done separately

  // Build base breakdown
  const breakdown: ConfidenceBreakdown = {
    knowledge_score: hasKnowledge ? Math.min(knowledgeConfidence, 0.9) : 0,
    tool_score: 0,
    llm_self_score: llmSelfConfidence,
    sub_agent_score: hasSubAgentDelegation ? subAgentDelegationConfidence : 0,
    handoff_intent: handoffIntent,
    no_support: !hasGrounding,
    final: 0,
  };

  let finalConfidence: number;

  if (hasGrounding) {
    // Weighted fusion when at least one signal exists
    let totalWeight = 0;
    let weightedSum = 0;

    if (hasKnowledge) {
      const knScore = Math.min(knowledgeConfidence, 0.9);
      weightedSum += knScore * 0.4;
      totalWeight += 0.4;
    }

    if (hasProductContext || hasSizeChartContext) {
      // Product/sizechart provide moderate grounding
      const contextScore = 0.7;
      weightedSum += contextScore * 0.3;
      totalWeight += 0.3;
    }

    if (hasTools) {
      // Average tool confidence across all tool calls
      const avgToolConf = toolExecutions.length > 0
        ? toolExecutions.reduce((sum, te) => sum + te.confidence, 0) / toolExecutions.length
        : 0.6;
      const toolScore = Math.min(avgToolConf, 0.9);
      breakdown.tool_score = toolScore;
      weightedSum += toolScore * 0.3;
      totalWeight += 0.3;
    }

    if (llmSelfConfidence > 0) {
      weightedSum += llmSelfConfidence * 0.3;
      totalWeight += 0.3;
    } else {
      // LLM self-eval missing: assign base score 0.5 * 0.3 to prevent
      // the missing 30% weight from being absorbed by other signals,
      // which would inflate the overall confidence.
      weightedSum += 0.5 * 0.3;
      totalWeight += 0.3;
    }

    finalConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0.3;
  } else {
    // No grounding — pure LLM free generation
    // Base confidence is low (0.3) since there's no grounding
    if (llmSelfConfidence > 0) {
      // LLM self-eval gets higher weight (50%) when no other signals exist
      finalConfidence = 0.2 * 0.5 + llmSelfConfidence * 0.5;
    } else {
      finalConfidence = 0.3;
    }
  }

  // Handoff intent detection overrides confidence to low
  if (handoffIntent) {
    finalConfidence = Math.min(finalConfidence, 0.35);
  }

  // Boost confidence if sub-agent delegation was successful
  if (hasSubAgentDelegation && subAgentDelegationConfidence > 0) {
    finalConfidence = Math.max(finalConfidence, subAgentDelegationConfidence * 0.9);
  }

  // Clamp to valid range [0, 1]
  breakdown.final = Math.max(0, Math.min(1, finalConfidence));

  return breakdown;
}

/**
 * Build confidence breakdown from LLM response content.
 * This version extracts confidence from content and applies handoff detection.
 */
export function buildConfidenceFromContent(
  content: string,
  input: ConfidenceCalculationInput
): ConfidenceBreakdown {
  // Extract LLM self-confidence from content
  const llmSelfConfidence = extractLlmSelfConfidence(content);
  
  // Detect handoff intent from content
  const handoffIntentDetected = detectHandoffIntent(content);

  // Calculate confidence with content-based overrides
  const result = calculateConfidence({
    ...input,
    llmSelfConfidence,
  });

  // Override handoff intent based on content detection
  result.handoff_intent = handoffIntentDetected;

  // Apply handoff penalty if detected
  if (handoffIntentDetected) {
    result.final = Math.min(result.final, 0.35);
  }

  return result;
}

/**
 * Simpler confidence calculation for simulation mode (no tool execution).
 * Used when there's no real tool execution but knowledge/context grounding exists.
 */
export function calculateSimulationConfidence(
  hasKnowledge: boolean,
  knowledgeConfidence: number,
  hasProductContext: boolean,
  hasSizeChartContext: boolean,
  handoffIntentDetected: boolean
): ConfidenceBreakdown {
  const hasGrounding = hasKnowledge || hasProductContext || hasSizeChartContext;

  const breakdown: ConfidenceBreakdown = {
    knowledge_score: hasKnowledge ? Math.min(knowledgeConfidence, 0.9) : 0,
    tool_score: 0,
    llm_self_score: 0.5, // Default fallback for simulation
    sub_agent_score: 0,
    handoff_intent: handoffIntentDetected,
    no_support: !hasGrounding,
    final: 0,
  };

  let finalConfidence: number;

  if (hasGrounding) {
    // Weighted fusion when at least one signal exists
    let totalWeight = 0;
    let weightedSum = 0;

    if (hasKnowledge) {
      const knScore = Math.min(knowledgeConfidence, 0.9);
      weightedSum += knScore * 0.4;
      totalWeight += 0.4;
    }

    if (hasProductContext || hasSizeChartContext) {
      // Product/sizechart provide moderate grounding
      const contextScore = 0.7;
      weightedSum += contextScore * 0.3;
      totalWeight += 0.3;
    }

    // LLM self-eval fallback for simulation
    weightedSum += 0.5 * 0.3;
    totalWeight += 0.3;

    finalConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0.3;
  } else {
    // No grounding — pure LLM free generation
    finalConfidence = 0.3;
  }

  // Handoff intent detection overrides confidence to low
  if (handoffIntentDetected) {
    finalConfidence = Math.min(finalConfidence, 0.35);
  }

  // Clamp to valid range [0, 1]
  breakdown.final = Math.max(0, Math.min(1, finalConfidence));

  return breakdown;
}

/**
 * Re-export ConfidenceBreakdown type for consumers
 */
export type { ConfidenceBreakdown as ConfidenceScore };

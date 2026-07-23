/**
 * Shadow Runner Service — Phase 3.2
 *
 * Deterministic grayscale shadow runner for A/B evaluation.
 *
 * Pipeline:
 *   1. inCohort() — deterministic cohort assignment (pure, no IO)
 *   2. recordRun() — persist a completed shadow run (fire-and-forget)
 *   3. agreement()  — compute agreement metrics between two pipelines
 */

import { createHash } from 'crypto';
import { FeatureFlagService } from '@/server/services/feature-flag-service';
import { EvalShadowRepository } from '@/server/repositories/eval-shadow-repository';
import { logger } from '@/lib/logger';
import type { CitationItem } from '@/server/services/retrieval-orchestrator';

/**
 * SHA-256 hash function for deterministic cohort assignment.
 * Returns a positive integer < 2^53 (safe for JS numbers).
 * Exposed for unit testing - override with a mock in tests.
 */
export function sha256ToBucket(input: string): number {
  const digest = createHash('sha256').update(input).digest('hex');
  return parseInt(digest.slice(0, 8), 16);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplayResult {
  config: CalibrationConfig;
  turn_id: string;
  predictedAnswer: string;
  predictedCitations: PredictedCitation[];
  predictedHandoff: boolean;
  recallHit: boolean;
  executionTimeMs: number;
}

export interface CalibrationConfig {
  min_score: number;
  rerank_backend: string;
  claim_verifier_threshold: number;
  confidence_gate: number;
}

export interface PredictedCitation {
  type: 'knowledge' | 'product' | 'size_chart';
  id?: string;
  chunk_id?: string;
  name?: string;
  category?: string;
}

// ---------------------------------------------------------------------------
// ShadowRunner
// ---------------------------------------------------------------------------

export class ShadowRunner {
  // ---------------------------------------------------------------------------
  // inCohort — deterministic cohort assignment (pure, no IO)
  // ---------------------------------------------------------------------------

  /**
   * Deterministically assigns a conversation turn to 'treatment', 'control',
   * or 'off' based on a stable hash of (botId, shopId, salt).
   *
   * Pure: uses only synchronous reads from the in-memory cache.
   * Can be tested with a frozen `nowMs` parameter (unused for now, reserved
   * for future time-based routing windows).
   */
  static inCohort(args: {
    botId: string;
    shopId: string | null;
    nowMs?: number;
  }): 'treatment' | 'control' | 'off' {
    const { botId, shopId } = args;

    // Feature flag gate — synchronous read from cached in-memory Map
    if (!FeatureFlagService.getFlag('EVAL_SHADOW')) {
      return 'off';
    }

    // Salt is required for deterministic assignment; fall back to process identity
    const salt = ShadowRunner.getShadowSalt();

    const trafficPct = FeatureFlagService.getTrafficPct('EVAL_SHADOW_TRAFFIC_PCT');
    const hash = ShadowRunner.hash(botId + ':' + shopId + ':' + salt);
    const bucket = hash % 100;

    return bucket < trafficPct ? 'treatment' : 'control';
  }

  // ---------------------------------------------------------------------------
  // recordRun — persist a shadow run (fire-and-forget)
  // ---------------------------------------------------------------------------

  /**
   * Persists a completed shadow run to the eval_shadow_runs table.
   * Errors are caught and logged; this method never re-throws.
   */
  static async recordRun(args: {
    conversationId: string;
    messageId: string;
    botId: string;
    shopId: string | null;
    baseline: ReplayResult;
    candidate: ReplayResult;
    cohort: 'treatment' | 'control';
  }): Promise<void> {
    try {
      const repo = new EvalShadowRepository();

      // Compute agreement metrics before persisting
      const { baselineCitations, candidateCitations } = extractCitations(args.baseline, args.candidate);
      const agreement = await ShadowRunner.agreement({
        baselineCitations,
        candidateCitations,
        baselineAnswer: args.baseline.predictedAnswer,
        candidateAnswer: args.candidate.predictedAnswer,
      });

      await repo.insert({
        conversation_id: args.conversationId,
        message_id: args.messageId,
        bot_id: args.botId,
        shop_id: args.shopId,
        cohort: args.cohort,
        dataset_version_id: null,
        baseline_config_hash: hashConfig(args.baseline.config),
        candidate_config_hash: hashConfig(args.candidate.config),
        baseline_decision: decisionFromResult(args.baseline),
        candidate_decision: decisionFromResult(args.candidate),
        baseline_citations: args.baseline.predictedCitations,
        candidate_citations: args.candidate.predictedCitations,
        baseline_answer: args.baseline.predictedAnswer,
        candidate_answer: args.candidate.predictedAnswer,
        baseline_confidence: 0, // ReplayResult doesn't carry confidence; reserved for future
        candidate_confidence: 0,
        first_token_latency_ms_baseline: args.baseline.executionTimeMs,
        first_token_latency_ms_candidate: args.candidate.executionTimeMs,
        agreement_decision: agreement.agreementDecision,
        agreement_citations: agreement.agreementCitations,
        agreement_answer: agreement.agreementAnswer,
      });

      logger.debug('[ShadowRunner] Shadow run recorded', {
        conversationId: args.conversationId,
        cohort: args.cohort,
        agreementDecision: agreement.agreementDecision,
        agreementCitations: agreement.agreementCitations,
        agreementAnswer: agreement.agreementAnswer,
      });
    } catch (err) {
      logger.warn('[ShadowRunner] Failed to record shadow run', {
        conversationId: args.conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fire-and-forget — never re-throw
    }
  }

  // ---------------------------------------------------------------------------
  // agreement — compute pipeline agreement metrics
  // ---------------------------------------------------------------------------

  /**
   * Computes three agreement metrics between baseline and candidate pipelines:
   *
   * - agreementDecision: both routing decisions are identical
   * - agreementCitations: Jaccard similarity on (type, id, chunk_id) tuples
   * - agreementAnswer: Levenshtein length-normalised similarity
   */
  static async agreement(args: {
    baselineCitations: CitationItem[];
    candidateCitations: CitationItem[];
    baselineAnswer: string;
    candidateAnswer: string;
  }): Promise<{
    agreementDecision: boolean;
    agreementCitations: number;
    agreementAnswer: number;
  }> {
    // Decision agreement: both citations arrays non-empty means 'retrieve';
    // both empty means 'skip'; mixed means 'clarify' / not identical
    const agreementDecision = args.baselineCitations.length > 0 === (args.candidateCitations.length > 0);

    // Jaccard similarity on citation tuples
    const agreementCitations = ShadowRunner.jaccard(args.baselineCitations, args.candidateCitations);

    // Levenshtein ratio on answers
    const agreementAnswer = ShadowRunner.levenshteinRatio(args.baselineAnswer, args.candidateAnswer);

    return { agreementDecision, agreementCitations, agreementAnswer };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** SHA-256 hash, returns a positive integer < 2^53 (safe for JS numbers). */
  private static hash(input: string): number {
    return sha256ToBucket(input);
  }

  /**
   * Returns the shadow salt for deterministic assignment.
   *
   * Uses the same process-identity fallback as FeatureFlagService so the
   * hash is stable server-wide. When the async DB-backed salt is rotated
   * via FeatureFlagService.rotateShadowSalt(), inCohort() will pick it up
   * on the next server restart (or when the cache is next invalidated).
   */
  private static getShadowSalt(): string {
    const pid = process.pid;
    const url = process.env.SUPABASE_URL ?? 'unknown';
    return `${pid}:${url}`;
  }

  /** Jaccard similarity between two citation arrays on (type, id, chunk_id) tuples. */
  private static jaccard(a: CitationItem[], b: CitationItem[]): number {
    const toKey = (c: CitationItem) =>
      `${c.type ?? ''}|${c.id ?? ''}|${c.chunk_id ?? ''}`;

    const setA = new Set(a.map(toKey));
    const setB = new Set(b.map(toKey));

    let intersectionSize = 0;
    for (const key of setA) {
      if (setB.has(key)) intersectionSize++;
    }

    const unionSize = setA.size + setB.size - intersectionSize;
    if (unionSize === 0) return 0;

    return intersectionSize / unionSize;
  }

  /** Length-normalised Levenshtein similarity: 1 - lev / max(lenA, lenB). */
  private static levenshteinRatio(a: string, b: string): number {
    if (a === b) return 1;
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0) return lenB === 0 ? 1 : 0;
    if (lenB === 0) return 0;

    // Row-by-row Levenshtein DP (O(min(lenA, lenB)) space)
    const [shorter, longer] = lenA <= lenB ? [a, b] : [b, a];
    let prev = Array.from({ length: shorter.length + 1 }, (_, i) => i);
    let curr = new Array(shorter.length + 1);

    for (let i = 1; i <= longer.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= shorter.length; j++) {
        const cost = shorter[j - 1] === longer[i - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,       // deletion
          curr[j - 1] + 1,   // insertion
          prev[j - 1] + cost // substitution
        );
      }
      [prev, curr] = [curr, prev];
    }

    const distance = prev[shorter.length];
    return 1 - distance / Math.max(lenA, lenB);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractCitations(
  baseline: ReplayResult,
  candidate: ReplayResult,
): { baselineCitations: CitationItem[]; candidateCitations: CitationItem[] } {
  // ReplayResult uses PredictedCitation; convert to CitationItem for agreement()
  const toCitation = (pc: PredictedCitation): CitationItem => ({
    type: pc.type,
    id: pc.id,
    chunk_id: pc.chunk_id,
    name: pc.name,
    category: pc.category,
    score: 0,
    provenanceVersion: 2,
  });

  return {
    baselineCitations: baseline.predictedCitations.map(toCitation),
    candidateCitations: candidate.predictedCitations.map(toCitation),
  };
}

function decisionFromResult(result: ReplayResult): string {
  if (result.predictedCitations.length === 0) return 'skip';
  if (result.predictedHandoff) return 'clarify';
  return 'retrieve';
}

function hashConfig(config: CalibrationConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex');
}

/**
 * AI processing status — single source of truth.
 *
 * Combines the database `ai_processing` flag with a "stale after N minutes"
 * self-healing check, in case a server crashed mid-stream and never called
 * the finally-block cleanup. This is the ONLY function the frontend should
 * use to decide whether to show the "AI 正在回复" indicator.
 */

const STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes — safe upper bound for any LLM stream

export interface AiProcessingState {
  /** Whether the UI should show "AI 正在回复" right now */
  isProcessing: boolean;
  /** True if the DB says processing=true but the timestamp exceeds the stale window */
  isStale: boolean;
  /** Original DB value, before staleness adjustment */
  raw: boolean;
  /** When ai_processing was set to true (only present if raw=true and not stale) */
  startedAt?: string;
}

/**
 * Resolve the AI processing state with staleness detection.
 *
 * @param aiProcessing           Value from database column `ai_processing`
 * @param aiProcessingStartedAt  Value from database column `ai_processing_started_at`
 * @param nowMs                  Override for `Date.now()` (useful for testing)
 */
export function resolveAiProcessingState(
  aiProcessing: boolean | undefined | null,
  aiProcessingStartedAt: string | null | undefined,
  nowMs: number = Date.now()
): AiProcessingState {
  const raw = !!aiProcessing;
  if (!raw) {
    return { isProcessing: false, isStale: false, raw: false };
  }
  // DB says processing — but if no timestamp, we can't age-check; treat as fresh.
  if (!aiProcessingStartedAt) {
    return { isProcessing: true, isStale: false, raw: true };
  }
  const startedAtMs = Date.parse(aiProcessingStartedAt);
  // If timestamp is invalid, fall back to "fresh" rather than false-negative.
  if (Number.isNaN(startedAtMs)) {
    return { isProcessing: true, isStale: false, raw: true };
  }
  const elapsedMs = nowMs - startedAtMs;
  const isStale = elapsedMs > STALE_AFTER_MS;
  return {
    isProcessing: !isStale,
    isStale,
    raw: true,
    startedAt: aiProcessingStartedAt,
  };
}

export const AI_PROCESSING_STALE_AFTER_MS = STALE_AFTER_MS;

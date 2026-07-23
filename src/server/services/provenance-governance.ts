/**
 * P3 Phase 2 — Provenance runtime governance.
 *
 * The single source of truth for "what does a citation of version N mean at runtime".
 *
 * Runtime rules (all deterministic, pure functions):
 *   - provenanceVersion === 2                              → trusted_v2 (kept as-is)
 *   - provenanceVersion === 1, no trace                    → suppress_with_legacy_badge (stale_trace)
 *   - provenanceVersion === 1, fresh trace + chunk_id valid → trusted_v1_with_audit_strip
 *   - provenanceVersion === 1, fresh trace + chunk_id gone → invalidated_v1 (chunk_identity_gone)
 *   - provenanceVersion === 1, fresh trace + no chunk_id + item_id gone → invalidated_v1
 *
 * Governance is applied inside LLMStreamingService.handlePostStreamOperations,
 * BEFORE claim verification (so the verifier sees the post-governance set).
 *
 * This module intentionally has NO dependencies on Supabase, HTTP, or async I/O.
 * It is a pure computation unit with its own test surface.
 */

import type { PublicCitationItem } from './llm-streaming-service';
import type { RetrievalTraceRow } from '@/server/repositories/retrieval-trace-repository';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Outcome of governing a single citation. */
export type GovernedCitation =
  | { kind: 'trusted_v2'; citation: PublicCitationItem }
  | { kind: 'trusted_v1_with_audit_strip'; citation: PublicCitationItem }
  | { kind: 'suppress_with_legacy_badge'; originalVersion: 1; reason: 'stale_trace' | 'unknown_chunk' }
  | { kind: 'invalidated_v1'; originalVersion: 1; reason: 'chunk_identity_gone' };

/** Result of governing a list of citations. */
export interface ProvenanceGovernanceResult {
  /** Citations that pass governance and may be shown to users. */
  kept: PublicCitationItem[];
  /** Citations that fail governance and are excluded. */
  suppressed: GovernedCitation[];
}

/** Options passed to governProvenance. */
export interface ProvenanceGovernanceOptions {
  /** Current wall-clock time in ms (injected to keep governProvenance pure). */
  nowMs: number;
  /**
   * Lookup: messageId → trace row.
   * Caller fetches the trace once and passes the map so governance is synchronous.
   * When absent, all v1 citations fall through to "no trace" suppression.
   */
  traceByMessageId?: Map<string, RetrievalTraceRow>;
  /**
   * Chunks known to exist in the database (for v1 invalidation checks).
   * If absent, v1 citations with a null chunk_id fall through to the item-id check.
   */
  knownChunkIds?: Set<string>;
  /**
   * Knowledge items known to exist in the database (for v1 invalidation when chunk_id is absent).
   * If absent, v1 citations without chunk_id are kept (optimistic).
   */
  knownItemIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** v1 citations with a trace older than this are treated as "stale" and suppressed. */
const V1_TRACE_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Core governance function
// ---------------------------------------------------------------------------

/**
 * Govern a list of citations.
 *
 * Pure: same inputs → same outputs. No Date.now() inside — pass `nowMs` explicitly.
 *
 * Governance rules (evaluated per citation, in order):
 *
 * 1. provenanceVersion === 2 → kept as trusted_v2
 *
 * 2. provenanceVersion === 1, no trace for this messageId → suppress_with_legacy_badge(stale_trace)
 *
 * 3. provenanceVersion === 1, trace exists, trace.created_at within 24h:
 *    → trusted_v1_with_audit_strip
 *    (the runtime is saying "we have a recent trace, treat as v2").
 *    The citation is DEEP-CLONED with provenanceVersion rewritten to 2.
 *
 * 4. provenanceVersion === 1, trace exists, chunk_id present, chunk_id NOT in knownChunkIds
 *    → invalidated_v1(chunk_identity_gone)
 *
 * 5. provenanceVersion === 1, trace exists, chunk_id absent, knowledge_item_id NOT in knownItemIds
 *    → invalidated_v1(chunk_identity_gone)
 *
 * 6. provenanceVersion === 1, trace exists, and:
 *    - chunk_id present + in knownChunkIds, OR
 *    - chunk_id absent + knowledge_item_id in knownItemIds
 *    → trusted_v1_with_audit_strip (same as rule 3)
 *
 * Note: governance does NOT filter v1 citations by synthetic_v1_backfill — that flag
 * is on the trace, not the citation. The governance function sees the citation only.
 * Synthetic backfill traces are indistinguishable from live traces after insertion;
 * the only difference is that synthetic traces have degraded=true and the
 * governance still applies rules 3–6 normally.
 */
export function governProvenance(
  citations: PublicCitationItem[],
  options: ProvenanceGovernanceOptions,
): ProvenanceGovernanceResult {
  const { nowMs, traceByMessageId, knownChunkIds, knownItemIds } = options;
  const kept: PublicCitationItem[] = [];
  const suppressed: GovernedCitation[] = [];

  for (const citation of citations) {
    const version = citation.provenanceVersion ?? 1;

    if (version === 2) {
      // Rule 1: v2 citations are always trusted.
      kept.push(citation);
      continue;
    }

    // version === 1 (or undefined, which defaults to 1 per the type)
    const trace = traceByMessageId?.get(citation.id ?? '');
    const traceAge = trace ? nowMs - new Date(trace.created_at).getTime() : Infinity;

    if (!trace) {
      // Rule 2: no trace → suppress.
      suppressed.push({ kind: 'suppress_with_legacy_badge', originalVersion: 1, reason: 'stale_trace' });
      continue;
    }

    if (traceAge > V1_TRACE_FRESHNESS_THRESHOLD_MS) {
      // Trace exists but is stale (>24h) → treat as no trace.
      suppressed.push({ kind: 'suppress_with_legacy_badge', originalVersion: 1, reason: 'stale_trace' });
      continue;
    }

    // Rule 3–6: fresh trace exists.
    const chunkId = citation.chunk_id;
    const itemId = citation.knowledge_item_id;

    if (chunkId != null) {
      // Citation has a chunk_id — check if it still exists.
      if (knownChunkIds && !knownChunkIds.has(chunkId)) {
        suppressed.push({ kind: 'invalidated_v1', originalVersion: 1, reason: 'chunk_identity_gone' });
        continue;
      }
      // chunk_id exists (or knownChunkIds not provided → optimistic keep).
    } else if (itemId != null && knownItemIds && !knownItemIds.has(itemId)) {
      // No chunk_id but has item_id — check if item still exists.
      suppressed.push({ kind: 'invalidated_v1', originalVersion: 1, reason: 'chunk_identity_gone' });
      continue;
    }

    // Rule 3 / 6: citation passes governance → keep with provenanceVersion rewritten to 2.
    kept.push({ ...citation, provenanceVersion: 2 });
  }

  return { kept, suppressed };
}

// ---------------------------------------------------------------------------
// Convenience: strip provenance markers from a single v1 citation (internal use)
// ---------------------------------------------------------------------------

/**
 * Returns a clean copy of a v1 citation with all v1-specific provenance markers
 * removed, ready to be shown as a "verified" citation.
 *
 * Currently the only marker is provenanceVersion (which we leave as-is so the
 * caller can see it was a v1 that was upgraded). This helper exists for future
 * expansion (e.g. if we add per-source audit strings that need stripping).
 */
export function stripV1Markers(citation: PublicCitationItem): PublicCitationItem {
  // Currently a no-op since we handle version rewriting in governProvenance.
  // Kept as a hook for future v1-only metadata fields.
  return { ...citation };
}

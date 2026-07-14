# P3 Provenance Governance & Claim-Level Attribution — Implementation Plan

**Date**: 2026-07-13
**Scope**: P3 of the RAG retrieval & citation initiative (P0–P2 already shipped, P4 deferred)
**Owner**: SmartAssist retrieval/citation workstream
**Status**: Plan only — **no implementation yet, no git commit yet**
**Companion docs**:
- `docs/superpowers/plans/2026-07-13-rag-retrieval-citation-implementation.md` (P0–P2 closure; defines the contract this plan extends)
- `supabase/migrations/20260713_rag_chunk_identity.sql`, `20260713_rag_chunk_identity_feedback.sql` (P2 chunk identity)
- `supabase/migrations/20260713_harden_rpc_search_path_and_privs.sql`, `20260713_enable_rls_batches.sql` (existing security baseline this plan must respect)

---

## 1. Background & Gap

P0–P2 closed the *relevance* layer of citations:
- P0 fixed the false-citation bug via query gating and fail-closed reranker policy.
- P1 introduced a single `RetrievalOrchestrator` and a public/private `EvidenceBundle` (`candidates` vs `accepted` vs `citations`).
- P2 made the citation key **stable** (`chunk_id`, `chunk_index`, `content_hash`) by upgrading the `match_knowledge_items` RPC and propagating chunk identity through `knowledge_feedback`.

P3 addresses the **trust** and **explainability** layer: a chunk that is *relevant* is not the same as a chunk that *supports the claim the assistant just emitted*. The current `Message.sources` is a list of citations, but the user (and the operator) cannot tell **which claim** each citation supports, **whether that claim was verified**, **how many turns ago the underlying evidence changed**, or **whether the citation still resolves to the same content**.

The user has called out five concrete gaps that must be closed in P3:

| # | Gap (user wording) | Why it matters now |
|---|--------------------|--------------------|
| 1 | "检索 trace 持久化数据库" — the `EvidenceTrace` from P1 lives only in `logger.agent.debug()` and is never persisted. Audit / regression / "why did the model cite X" is unanswerable. | Operators cannot reproduce a bad citation, cannot compute P95 retrieval latency per rerank backend, and cannot ground A/B sweeps on real trace data. |
| 2 | "完整历史 provenanceVersion: 1 升级与运行时治理" — every existing `messages.sources[*].provenanceVersion === 1` row is left as-is with no audit / migration / runtime downgrade path. | The "未核验引用" badge appears forever for legacy rows even after the underlying citations become invalid; the runtime cannot decide whether to honor, suppress, or re-verify a v1 citation. |
| 3 | "展示'来源支持回答中的哪一段'" — `SourcePanel` shows the citation *content*, not the *span inside the AI reply* that the citation supports. | The user has to mentally diff the AI reply against the citation. That is exactly the friction that breaks trust. |
| 4 | "商品和尺码表可独立验证的证据记录" — the orchestrator always returns `citations: []` for product / size-chart contexts (see `buildProductBundle` / `buildSizeChartBundle` in `retrieval-orchestrator.ts`). The DB-side evidence unit for product / size-chart does not exist as a first-class table. | The user has no way to inspect "what exactly about this SKU does the AI claim, and is that claim backed by the row we shipped?" |
| 5 | "numbered-choice 门控从文本上下文启发式改成可信 UI action / pending-choice 状态" — `RetrievalGatingService.isAfterNumberedChoices()` reads assistant message *text* for `/请选择|1.xxx|请回复/` patterns to decide whether `"1"` is meaningful. | The decision is text-shape dependent, breaks the moment we change the assistant prompt, and is unfalsifiable from logs. The fix is to mark the offer **explicitly** in the assistant message (`pending_choice`) and let the UI / orchestrator read that signal. |

This plan ships all five. The four on-disk artifacts each ship in their own independently-deliverable phase; phase 5 ties them together at the chat surface.

---

## 2. Behavior Contract (After This Plan)

### 2.1 Persisted retrieval trace (closes gap 1)

Every assistant message that runs the LLM stream produces a `retrieval_traces` row alongside the existing `messages` row (and any future `claim_attestations` row, see §2.4). The trace row contains:

- The `RetrievalGateDecision` (action / reasonCode / effectiveQuery / confidence / requiredSlots).
- A serialized `EvidenceBundle.trace` (rerank degraded flag, candidate/accepted/citation counts, rerankBackend, hybridSearch, minScore, modelVersion, executionTimeMs).
- The conversation id, message id, bot id, and `trace_started_at` / `trace_completed_at` timestamps.
- The text-digest (`sha256(user_message)`, first 200 chars of `effective_query`) so traces are searchable without PII risk.

The trace write is **fire-and-forget inside `handlePostStreamOperations`** and is best-effort: trace loss MUST NOT break the SSE stream or the assistant message insert. Failure modes are explicit (§3.4) and the trace table is append-only with a 30-day TTL surfaced via a documented retention migration.

### 2.2 Provenance runtime governance (closes gap 2)

A new module `src/server/services/provenance-governance.ts` becomes the single source of truth for "what does a citation of version N mean at runtime". It exposes three pure functions:

```ts
governProvenance(citation: PublicCitationItem, options: { nowMs: number; trace?: TraceRow | null }): GovernedCitation
// returns one of:
//   - { kind: 'trusted_v2', citation }                  — v2 + recent trace → keep
//   - { kind: 'trusted_v1_with_audit_strip', citation } — v1 + trace within 24h → keep, but rewrite provenanceVersion to 2 + audit-strip provenance v1 markers
//   - { kind: 'suppress_with_legacy_badge', reason }    — v1 + no trace or stale trace → emit empty
//   - { kind: 'invalidated_v1', reason }                — v1 + chunk identity gone → suppress
```

The runtime governance is applied **inside `LLMStreamingService.createStream`**, in the same place where P2 currently applies `claimVerificationResult`. The function is pure, has its own test surface, and is deterministic given `(citation, nowMs, traceRow)`. Legacy v1 messages that pass through governance keep the "未核验引用" badge that `SourcePanel` already renders (P2 surface); v1 messages that fail governance are filtered out before persistence, so the public `Message.sources` always reflects the governed view.

A backward-compatible **offline backfill migration** computes the chunk identity for the most recent 90 days of messages whose sources contain v1 citations and writes a synthetic `retrieval_traces` row marked `synthetic_v1_backfill: true`. After the migration runs, all v1 messages either:
- get governed to `trusted_v1_with_audit_strip` if the chunk identity still exists in `knowledge_chunks`, or
- get marked `invalidated_v1` (the route re-evaluates on next load) — and operators can run `SELECT count(*) FROM messages WHERE ...` to see the affected set.

The runtime governance must NOT require this backfill to function correctly: it works fine on the append-only path. The backfill is for legacy rows.

### 2.3 Span-level citation (closes gap 3)

`ClaimSupportVerifier` already produces `verdict: entailed | contradicted | ambiguous` per citation. P3 promotes that output into a **first-class `claim_attestations` row** with the span coordinates inside the AI reply:

```ts
interface ClaimAttestation {
  id: string;                       // uuid
  message_id: string;
  citation_index: number;           // 0-based index into Message.sources
  citation_type: 'knowledge' | 'product' | 'size_chart' | 'auto_reply' | 'sub_agent_delegation' | 'tool';
  // Span coordinates: half-open offsets inside the assistant reply (post strip-internal-markers).
  span_start: number;               // 0-based character offset, inclusive
  span_end: number;                 // 0-based character offset, exclusive
  span_text: string;                // substring of fullContent[span_start:span_end]
  verdict: 'entailed' | 'contradicted' | 'ambiguous' | 'unverifiable';
  confidence: number;               // 0..1, claim support probability from the verifier
  verifier_model: string;           // e.g. "doubao-seed-2-0-lite-260215"
  rationale: string;                // short reason from verifier (truncated to 240 chars)
  chunk_id?: string | null;
  knowledge_item_id?: string | null;
  product_id?: string | null;       // NEW: see §2.4
  size_chart_id?: string | null;    // NEW
  created_at: string;
}
```

Span coordinates come from the same auxiliary LLM call that already powers `ClaimSupportVerifier`; P3 extends its prompt to **return** the span as a UTF-16 offset pair, validated against the post-strip reply length. A deterministic fallback path runs when the verifier fails or the span is missing: it produces one attestation per citation with `span_start: 0`, `span_end: 0`, `span_text: ''`, `verdict: 'unverifiable'`. The fallback is always emitted so the chat surface can render "no span".

`SourcePanel` is extended with a "支持的片段" row that highlights `msg.content.slice(span_start, span_end)` in a `<mark>` block, scoped to the citation row, and a small "全文定位" button that scrolls the parent message bubble to the span (using a `data-claim-span-start` attribute added by `chat-window.tsx`). Highlight color is keyed to `verdict` (entailed=primary, contradicted=destructive, ambiguous=muted, unverifiable=outline).

### 2.4 Product & size-chart evidence records (closes gap 4)

P2 currently leaves product / size-chart context out of public citations entirely (orchestrator's `buildProductBundle` and `buildSizeChartBundle` always return `citations: []` and only attach context for LLM consumption). P3 introduces two narrow evidence records that survive the gate:

- `product_citations` — written when (a) the user message reaches the `retrieve` action, (b) the product context comes from a non-empty `productContext`, AND (c) the row's `content_hash` (already computed by `buildProductContentHash`) matches the *current* `product_details.content_hash` for the SKU. The record carries `product_id`, `sku`, `matched_field` (`name | sku | category | description | specifications`), `evidence_excerpt` (a ≤ 240-char substring of the row text that LLM was given), and a `verification_status` (`matched | hash_mismatch | sku_missing`). Only `matched` rows are eligible for `Message.sources`.
- `size_chart_citations` — symmetric structure with `size_chart_id`, `matched_field`, and `evidence_excerpt` from the row text. Verification is hash comparison via `buildSizeChartContentHash`. Only hash-matching rows become public citations.

Both records use the **same `claim_attestations` table** from §2.3 — `citation_type = 'product' | 'size_chart'` instead of needing a second schema. `claim_attestations` is the universal "what claim did the assistant make, supported by what evidence" log; `product_citations` and `size_chart_citations` are not new tables, they are **rows in `claim_attestations` with a non-null `product_id` / `size_chart_id` and a `citation_type` discriminator**. This keeps the per-turn UI cost constant regardless of which evidence channels the orchestrator opens.

The orchestrator contract becomes: `EvidenceBundle.citations` may now contain entries with `type: 'product' | 'size_chart'`. Each entry carries `product_id | size_chart_id` plus the matched-field metadata. The current `buildProductBundle`/`buildSizeChartBundle` short-circuit (always `citations: []`) is removed; instead they call into the new `ProductEvidenceService` / `SizeChartEvidenceService` which perform hash verification and emit either an attested citation or a degradation reason (`product_hash_mismatch`, `size_chart_disabled`, etc.).

A migration is required only if `claim_attestations` does not yet exist (see §3.2 for the table definition). The product / size-chart rows piggy-back on the same table.

### 2.5 UI-trusted pending-choice signal (closes gap 5)

The heuristic `isAfterNumberedChoices()` in `retrieval-gating-service.ts` is replaced by an explicit machine-readable signal:

- `LLMStreamingService` gains a new internal marker pattern `[PENDING_CHOICE]{"options":[{"id":"1","label":"…"},{"id":"2","label":"…"}]}[/PENDING_CHOICE]`. The marker is part of the assistant message body (visible to the user as a structured question card rendered by `chat-window.tsx`).
- Before streaming the marker out, the streaming service parses it into a typed `PendingChoice { id: string; questionId: string; options: Array<{ id: string; label: string }>; expiresAtMs: number }` and **attaches it to the SSE done event** as `done.pending_choice`. The chat surface caches the most recent `pending_choice` per conversation (keyed by `questionId`) in `chat-page.tsx`.
- `RetrievalGatingService.shouldRetrieve(query, recentMessages, { pendingChoices })` takes a third argument. The new code path: if the trimmed query matches one of the pending option IDs (exact or after stripping leading punctuation / whitespace), it returns `{ action: 'retrieve', reasonCode: 'pending_choice_answer', confidence: 0.95, effectiveQuery: pendingChoice.optionLabel }`. Otherwise it returns the existing SKIP for numerics. **The text-shape heuristic is removed entirely** from the gating service.
- A pending choice has a 10-minute TTL (`expiresAtMs = createdAtMs + 600_000`). After expiry, the option ID is treated as a normal numeric and skipped. The TTL is enforced both in `chat-page.tsx` (UI drops the cached pending choice) and in `LLMStreamingService` (drops `done.pending_choice` when emitting, which is why `chat-page.tsx` is the source of truth).
- The `[PENDING_CHOICE]` marker is **never** sent through `data: { content: … }` SSE events — it is stripped before content emission, exactly like `[CONF:x.x]` is stripped. It only travels through `done.pending_choice`. That keeps the user-visible reply free of bracketed markers.

The list `pendingChoices` argument is plumbed from the messages route → orchestrator → gating service. The route reads the most recent `done.pending_choice` for the conversation from a thin per-conversation cache (`memory-store` keyed by `conversationId`, lru 256 entries) populated by `LLMStreamingService` post-stream. Simulation route uses the same cache.

---

## 3. Implementation Phases

Each phase is independently shippable behind a feature flag (`PROVENANCE_V2_GOVERNANCE`, `TRACE_PERSIST`, `CLAIM_ATTESTATIONS`, `PENDING_CHOICE_V2`). Phases 1–4 do not depend on each other's schema; phase 5 ties them together.

The phases are not parallelizable: phase 3 writes `claim_attestations` and phase 4 reads them, phase 2 governs everything that phase 3 verified, phase 1 is the trace store that phase 2 consults. They are stacked in dependency order.

### Phase 1 — Persisted retrieval trace

**Goal**: every assistant message leaves an audit row that operators can query.

#### 3.1.1 New file: `src/server/services/retrieval-trace-service.ts`

Responsibility: build, persist, and read `retrieval_traces` rows. Pure functions for the build path; the persist path is fire-and-forget.

```ts
export interface RetrievalTraceRow {
  id: string;
  conversation_id: string;
  message_id: string | null;            // null until the assistant message is inserted
  decision_action: RetrievalAction;
  decision_reason_code: ReasonCode;
  effective_query: string;
  effective_query_digest: string;       // sha256 hex
  rerank_backend: 'bge' | 'cohere' | 'generic' | 'mock' | 'none';
  rerank_degraded: boolean;
  hybrid_search: boolean;
  candidate_count: number;
  accepted_count: number;
  citation_count: number;
  min_score: number;
  model_version: string | null;
  execution_time_ms: number;
  degradation_reasons: string[];
  synthetic_v1_backfill: boolean;       // true only when §3.2.4 emits rows
  bot_id: string | null;
  trace_started_at: string;
  trace_completed_at: string;
  created_at: string;
}

export class RetrievalTraceService {
  async buildFromBundle(args: {
    conversationId: string;
    messageId: string | null;
    decision: RetrievalGateDecision;
    evidence: EvidenceBundle;
    userMessage: string;
    botId?: string | null;
    startedAtMs: number;
  }): Promise<Omit<RetrievalTraceRow, 'id' | 'created_at'>> { /* ... */ }

  async persist(row: RetrievalTraceRow): Promise<void> { /* insert; never throws to caller */ }
  async getByMessageId(messageId: string): Promise<RetrievalTraceRow | null>;
  async getByConversationId(conversationId: string, opts: { limit: number; beforeMs?: number }): Promise<RetrievalTraceRow[]>;
  async listRecent(opts: { limit: number; rerankBackend?: string }): Promise<RetrievalTraceRow[]>;
}
```

The `persist` path uses `getSupabaseClient().from('retrieval_traces').insert(...)` and swallows errors with `logger.api.warn('retrieval-trace-persist-failed', { error })`. It MUST NOT re-throw.

#### 3.1.2 New file: `src/server/repositories/retrieval-trace-repository.ts`

Thin wrapper around the table. The service above holds the build / read API; the repository is just typed insert/select.

#### 3.1.3 New migration: `supabase/migrations/20260713_retrieval_traces.sql`

Table definition (UUID PK, NOT NULL where required, indexes for the read paths the service exposes):

```sql
CREATE TABLE IF NOT EXISTS public.retrieval_traces (
  id                     varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id        varchar(36) NOT NULL,
  message_id             varchar(36),                                  -- nullable until assistant row exists
  decision_action        varchar(20)  NOT NULL,
  decision_reason_code   varchar(40)  NOT NULL,
  effective_query        text         NOT NULL,
  effective_query_digest varchar(64)  NOT NULL,                        -- sha256 hex
  rerank_backend         varchar(16)  NOT NULL DEFAULT 'none',
  rerank_degraded        boolean      NOT NULL DEFAULT false,
  hybrid_search          boolean      NOT NULL DEFAULT false,
  candidate_count        integer      NOT NULL DEFAULT 0,
  accepted_count         integer      NOT NULL DEFAULT 0,
  citation_count         integer      NOT NULL DEFAULT 0,
  min_score              double precision NOT NULL DEFAULT 0,
  model_version          varchar(64),
  execution_time_ms      integer      NOT NULL DEFAULT 0,
  degradation_reasons    jsonb        NOT NULL DEFAULT '[]'::jsonb,
  synthetic_v1_backfill  boolean      NOT NULL DEFAULT false,
  bot_id                 varchar(36),
  trace_started_at       timestamptz  NOT NULL,
  trace_completed_at     timestamptz  NOT NULL DEFAULT now(),
  created_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retrieval_traces_conversation_idx   ON public.retrieval_traces (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS retrieval_traces_message_idx        ON public.retrieval_traces (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retrieval_traces_rerank_idx         ON public.retrieval_traces (rerank_backend, rerank_degraded);
CREATE INDEX IF NOT EXISTS retrieval_traces_digest_idx         ON public.retrieval_traces (effective_query_digest);

-- Append-only retention: 30 days. A separate operational migration drops older rows.
-- Documented in §3.4.

-- RLS: explicitly disabled to match the existing tables pattern (see 20260713_enable_rls_batches.sql /
-- 20260707_disable_all_rls.sql — the project currently runs without RLS on this family).
-- We DO NOT enable RLS in this migration; doing so would require aligning with that pattern.
-- Keep the comment in the migration so reviewers see the deliberate choice.

-- Privileges: revoke PUBLIC, grant service_role only — same hardening as 20260713_rag_chunk_identity.sql.
REVOKE ALL ON TABLE public.retrieval_traces FROM PUBLIC;
REVOKE ALL ON TABLE public.retrieval_traces FROM anon;
REVOKE ALL ON TABLE public.retrieval_traces FROM authenticated;
GRANT ALL ON TABLE public.retrieval_traces TO service_role;

NOTIFY pgrst, 'reload';
```

#### 3.1.4 Modify: `src/server/services/llm-streaming-service.ts`

Add a single fire-and-forget call at the end of `handlePostStreamOperations`, after the existing `insertMessage`:

```ts
// Persist retrieval trace (best-effort; failure must never block the user).
retrievalTraceService.persist({
  conversationId,
  messageId: assistantInsertedId,           // returned by insertMessageAndReturn (see §3.1.5)
  decision: options.decision ?? previousDecision,  // threaded through LLMStreamOptions
  evidence: options.evidence ?? previousBundle,
  userMessage,
  botId: options.parentBotId ?? null,
  startedAtMs: streamStartedAtMs,           // captured in createStream before the inner async block
}).catch((err) => {
  logger.api.warn('retrieval-trace-persist-failed', { error: err, conversationId });
});
```

This means `LLMStreamOptions` gains three optional fields: `decision`, `evidence`, plus `decisionStartedAtMs`. The conversations messages route already builds both via the orchestrator (see lines 287–294 of `messages/route.ts`); phase 1 just plumbs them into the streaming options and the streaming service writes the trace. Both simulation and production messages routes apply this.

#### 3.1.5 Modify: `src/server/services/conversation-service.ts` and `src/server/repositories/conversation-repository.ts`

`insertMessage` must return the new message id so the trace can reference it. Current `insertMessage` returns `Promise<void>`; `insertMessageAndReturn` already exists with the right signature. Switch `handlePostStreamOperations` to call `insertMessageAndReturn` (returns `Message`), keep the fire-and-forget semantics by `.catch()`-ing the awaited promise.

#### 3.1.6 Modify: `src/app/api/conversations/[id]/messages/route.ts`

Pass `decision` / `evidence` / `decisionStartedAtMs` to `llmStreamingService.createStream`. The values come from the `retrievalResult` already returned by the orchestrator (lines 286–294). The simulation route mirrors this change.

#### 3.1.7 Tests (must pass before merge)

New file: `src/server/services/retrieval-trace-service.test.ts`
- `buildFromBundle` produces deterministic shape (idempotent given same inputs)
- `effective_query_digest` is sha256 of normalized query (whitespace trimmed, NFC-normalized)
- `persist` swallows errors from the Supabase client (mock rejects → still resolves)
- `getByMessageId` returns the persisted row when the repository returns it

New file: `src/app/api/conversations/[id]/messages/route.trace.test.ts`
- Mocks `RetrievalTraceService.persist` and asserts it is called with the trace derived from the orchestrator's `EvidenceBundle`.
- Asserts `persist` rejection does NOT fail the SSE stream.

#### 3.1.8 Acceptance criteria (phase 1)

- `pnpm exec tsc --noEmit --project tsconfig.json` clean.
- New tests pass.
- `pnpm test:run` all green.
- A new trace row appears in `retrieval_traces` for each production assistant message in the live env.
- Dropping the `retrieval_traces` table does NOT break the SSE stream (the persist path is logged and swallowed).

#### 3.1.9 Rollback

`DROP TABLE public.retrieval_traces;` plus removing the fire-and-forget call in `handlePostStreamOperations`. No application state to unwind.

---

### Phase 2 — Provenance governance & v1 backfill

**Goal**: the runtime decides for each `sources[*]` whether to keep, suppress, or rewrite, deterministically.

#### 3.2.1 New file: `src/server/services/provenance-governance.ts`

```ts
export type GovernedCitation =
  | { kind: 'trusted_v2'; citation: PublicCitationItem }
  | { kind: 'trusted_v1_with_audit_strip'; citation: PublicCitationItem; originalVersion: 1 }
  | { kind: 'suppress_with_legacy_badge'; originalVersion: 1; reason: 'stale_trace' | 'unknown_chunk' }
  | { kind: 'invalidated_v1'; originalVersion: 1; reason: 'chunk_identity_gone' };

export interface ProvenanceGovernanceOptions {
  nowMs: number;
  traceByMessageId?: Map<string, RetrievalTraceRow>;     // caller-provided to keep this pure
  // Cached lookups: caller passes the chunk-existence map for v1 invalidation checks.
  knownChunkIds?: Set<string>;
  knownItemIds?: Set<string>;
}

export function governProvenance(
  citations: PublicCitationItem[],
  options: ProvenanceGovernanceOptions,
): { kept: PublicCitationItem[]; suppressed: GovernedCitation[] };
```

The function is pure, total, and synchronous. It is **the only** place that decides what a v1 citation means at runtime. It MUST be deterministic — same inputs, same outputs, no Date.now() calls inside.

Decision rules (encoded in the function):
- `provenanceVersion === 2` → `trusted_v2` (kept as-is, no rewrite).
- `provenanceVersion === 1` AND no trace for the message → `suppress_with_legacy_badge` reason `stale_trace`.
- `provenanceVersion === 1` AND trace exists AND trace.created_at within 24h of `nowMs` → `trusted_v1_with_audit_strip`. The citation is deep-cloned and `provenanceVersion` is set to `2` (the runtime is saying "we have a recent trace, treat as v2"). The `synthetic_v1_backfill` flag on the trace is read but not enforced here; backfill governance lives in §3.2.4.
- `provenanceVersion === 1` AND trace exists AND `chunk_id` present AND `chunk_id` not in `knownChunkIds` → `invalidated_v1` reason `chunk_identity_gone`.
- `provenanceVersion === 1` AND trace exists AND `chunk_id` is null AND `knowledge_item_id` not in `knownItemIds` → `invalidated_v1` reason `chunk_identity_gone`.

The function never throws; it returns `kept` and `suppressed` separately so the caller can surface the suppressions in logs.

#### 3.2.2 Modify: `src/server/services/llm-streaming-service.ts`

Inside the `evidenceCitations` loop (lines 593–613), after each citation is appended to `sources`, run the governance function. Use `sources` array as the input and call `governProvenance`. The trace for the current message is fetched via `RetrievalTraceService.getByMessageId` (added in §3.1) before the loop; if `getByMessageId` fails, governance falls back to "no trace" path.

```ts
const traceRow = await retrievalTraceService.getByMessageId(messageId).catch(() => null);
const governed = governProvenance([...evidenceCitations], {
  nowMs: Date.now(),
  traceByMessageId: traceRow ? new Map([[messageId, traceRow]]) : undefined,
});
sources.length = 0;
for (const kept of governed.kept) sources.push(kept);
// Surface suppressions to observability.
if (governed.suppressed.length > 0) {
  logger.agent.debug('[LLMStreamingService] Suppressed v1 citations', {
    conversationId,
    messageId,
    suppressed: governed.suppressed.map(s => ({ reason: s.kind === 'invalidated_v1' ? s.reason : 'unknown_chunk' })),
  });
}
```

Note: governance runs **before** claim verification (so the verifier sees the post-governance, deterministic citation set), but **after** the orchestrator-graded `evidenceCitations` are copied into `sources`. The `claimVerificationResult.sources` filter continues to operate on the post-governance `sources`. Both the SSE `done.sources` and the persisted `Message.sources` reflect the governed set.

#### 3.2.3 Modify: `src/app/api/simulations/[id]/messages/route.ts`

The simulation route saves the assistant message with `sources: verifiedSources ?? undefined` (line 460). Apply governance to `verifiedSources` before the insert — same call as in §3.2.2, with `traceRow = null` (sims do not persist traces in phase 1, they will in phase 4 once the simulation trace migration is added; for now, governance treats sim messages as "no trace" which means all v1 sim messages get suppressed. That is acceptable: simulation rows are not user-visible audit targets).

#### 3.2.4 New migration: `supabase/migrations/20260713_provenance_v1_backfill.sql`

Offline backfill. Idempotent (`ON CONFLICT DO NOTHING` via a unique key on `(message_id, source_index)`). For each `messages` row whose `sources` jsonb contains `provenanceVersion = 1`:

1. Compute `effective_query_digest` from `user_query_snapshot` (we add `effective_query` directly: the route did not record one for v1 messages, so we use a placeholder `'legacy_v1_no_query'`, hash it deterministically).
2. Compute `candidates_count` from `sources.length`, `accepted_count` = same, `citation_count` = same.
3. Insert a synthetic `retrieval_traces` row with `synthetic_v1_backfill: true`, `decision_reason_code: 'legacy_v1_no_decision_recorded'`, `trace_started_at = message.created_at`, `trace_completed_at = message.created_at`.
4. The backfill is wrapped in batches of 500 with `LIMIT` + `OFFSET` to avoid holding large transactions. Migration notes explain the loop driver.

```sql
DO $$
DECLARE
  batch_size int := 500;
  processed int := 0;
BEGIN
  LOOP
    WITH next_batch AS (
      SELECT id
      FROM public.messages
      WHERE role = 'assistant'
        AND sources @> '[{"provenanceVersion": 1}]'::jsonb
        AND created_at >= now() - interval '90 days'
        AND NOT EXISTS (
          SELECT 1 FROM public.retrieval_traces t
          WHERE t.message_id = messages.id AND t.synthetic_v1_backfill = true
        )
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    ),
    inserted AS (
      INSERT INTO public.retrieval_traces (
        conversation_id, message_id, decision_action, decision_reason_code,
        effective_query, effective_query_digest, rerank_backend, rerank_degraded,
        hybrid_search, candidate_count, accepted_count, citation_count,
        min_score, model_version, execution_time_ms, degradation_reasons,
        synthetic_v1_backfill, trace_started_at, trace_completed_at
      )
      SELECT
        m.conversation_id, m.id, 'retrieve', 'legacy_v1_no_decision_recorded',
        'legacy_v1_no_query', encode(digest('legacy_v1_no_query', 'sha256'), 'hex'),
        'none', true, false,
        jsonb_array_length(m.sources), jsonb_array_length(m.sources), jsonb_array_length(m.sources),
        0, null, 0, '["legacy_v1_backfill"]'::jsonb,
        true, m.created_at, m.created_at
      FROM next_batch b
      JOIN public.messages m ON m.id = b.id
      RETURNING 1
    )
    SELECT count(*) INTO processed FROM inserted;
    EXIT WHEN processed = 0;
    RAISE NOTICE 'Backfilled % synthetic v1 traces (this batch)', processed;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload';
```

The migration must run after `20260713_retrieval_traces.sql`. The 90-day window is the same window the governance function uses for `stale_trace` rejection.

#### 3.2.5 Tests

New file: `src/server/services/provenance-governance.test.ts`. Pure-function tests:
- v2 citation → kept untouched
- v1 citation, no trace → suppressed, reason `stale_trace`
- v1 citation, fresh trace, chunk_id present in `knownChunkIds` → kept, version rewritten to 2
- v1 citation, fresh trace, chunk_id present but NOT in `knownChunkIds` → invalidated, reason `chunk_identity_gone`
- v1 citation, fresh trace, no chunk_id, knowledge_item_id NOT in `knownItemIds` → invalidated, reason `chunk_identity_gone`
- v1 citation, fresh trace, no chunk_id, knowledge_item_id in `knownItemIds` → kept, version rewritten to 2
- Deterministic: two calls with same inputs produce equal outputs.

#### 3.2.6 Acceptance criteria (phase 2)

- All v1 citations on legacy messages either get rewritten to v2 (visible in the next load) or are filtered out of `Message.sources`.
- The synthetic `retrieval_traces` row count equals the number of v1 messages within the 90-day window.
- The `pnpm test:run` suite still green.
- The `SourcePanel` continues to render the "未核验引用" badge for `provenanceVersion === 1` after the rewrite window closes (the governance path emits the citation with `provenanceVersion: 2`, so the badge disappears; this is intentional — the badge is now reserved for messages that the runtime could not govern).

#### 3.2.7 Rollback

Drop the synthetic rows: `DELETE FROM public.retrieval_traces WHERE synthetic_v1_backfill = true;`. Revert `governProvenance` call site. No schema change to revert.

---

### Phase 3 — Claim attestations with span coordinates

**Goal**: every citation has a typed attestation that ties it to a span in the assistant reply.

#### 3.3.1 New migration: `supabase/migrations/20260713_claim_attestations.sql`

```sql
CREATE TABLE IF NOT EXISTS public.claim_attestations (
  id                 varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id         varchar(36) NOT NULL,
  citation_index     integer     NOT NULL,
  citation_type      varchar(40) NOT NULL,                  -- knowledge | product | size_chart | auto_reply | sub_agent_delegation | tool
  span_start         integer     NOT NULL,
  span_end           integer     NOT NULL,
  span_text          text        NOT NULL DEFAULT '',
  verdict            varchar(20) NOT NULL,                  -- entailed | contradicted | ambiguous | unverifiable
  confidence         double precision NOT NULL DEFAULT 0,
  verifier_model     varchar(64) NOT NULL DEFAULT '',
  rationale          text        NOT NULL DEFAULT '',
  chunk_id           varchar(36),
  knowledge_item_id  varchar(36),
  product_id         varchar(36),                            -- NEW: see §3.4
  size_chart_id      varchar(36),                            -- NEW
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claim_attestations_message_idx          ON public.claim_attestations (message_id);
CREATE INDEX IF NOT EXISTS claim_attestations_message_idx_idx      ON public.claim_attestations (message_id, citation_index);
CREATE INDEX IF NOT EXISTS claim_attestations_chunk_idx            ON public.claim_attestations (chunk_id) WHERE chunk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS claim_attestations_knowledge_item_idx   ON public.claim_attestations (knowledge_item_id) WHERE knowledge_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS claim_attestations_product_idx           ON public.claim_attestations (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS claim_attestations_size_chart_idx        ON public.claim_attestations (size_chart_id) WHERE size_chart_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS claim_attestations_verdict_idx           ON public.claim_attestations (verdict);

-- Hardening (mirrors 20260713_rag_chunk_identity.sql).
REVOKE ALL ON TABLE public.claim_attestations FROM PUBLIC;
REVOKE ALL ON TABLE public.claim_attestations FROM anon;
REVOKE ALL ON TABLE public.claim_attestations FROM authenticated;
GRANT ALL ON TABLE public.claim_attestations TO service_role;

NOTIFY pgrst, 'reload';
```

#### 3.3.2 Modify: `src/server/services/claim-support-verifier.ts`

The verifier currently returns `{ ok, sources, code?, reason? }`. P3 extends the verifier's prompt and output schema:

```ts
export interface ClaimVerificationAttestation {
  citation_index: number;
  verdict: 'entailed' | 'contradicted' | 'ambiguous' | 'unverifiable';
  confidence: number;
  rationale: string;             // truncated to 240 chars
  span_start: number | null;     // null if the verifier could not find a span
  span_end: number | null;
}

export interface ClaimVerificationResult {
  ok: boolean;
  code?: string;
  reason?: string;
  sources: Array<PublicCitationItem & {
    span_start?: number | null;
    span_end?: number | null;
    rationale?: string;
  }>;
  attestations: ClaimVerificationAttestation[];
  rawVerifierOutput?: unknown;   // for debugging; never persisted
}
```

The verifier's prompt (the LLM call) is updated so the JSON response includes `attestations[*].span_start` and `attestations[*].span_end` measured against `assistantReply` (post-`stripInternalMarkers`, the same string the user sees). Existing tests are updated to assert the new shape.

A pure helper `validateSpan(span, reply)`: rejects spans where `span_end <= span_start`, where `span_end > reply.length`, or where the substring does not equal a normalized form of `reply.slice(span_start, span_end)`. Invalid spans become `span_start: null, span_end: null`.

#### 3.3.3 New file: `src/server/services/claim-attestation-service.ts`

Responsibility: persist attestations, generate the unverifiable fallback, and read them back for the chat surface.

```ts
export interface ClaimAttestationInput {
  messageId: string;
  citationIndex: number;
  citationType: 'knowledge' | 'product' | 'size_chart' | 'auto_reply' | 'sub_agent_delegation' | 'tool';
  spanStart: number;
  spanEnd: number;
  spanText: string;
  verdict: 'entailed' | 'contradicted' | 'ambiguous' | 'unverifiable';
  confidence: number;
  verifierModel: string;
  rationale: string;
  chunkId?: string | null;
  knowledgeItemId?: string | null;
  productId?: string | null;
  sizeChartId?: string | null;
}

export class ClaimAttestationService {
  async persistAll(rows: ClaimAttestationInput[]): Promise<void>;       // batch insert; never throws
  async getByMessageId(messageId: string): Promise<ClaimAttestationRow[]>;
  async getByMessageIds(messageIds: string[]): Promise<Map<string, ClaimAttestationRow[]>>;  // batched for chat surface
}
```

`persistAll` is called from `LLMStreamingService.handlePostStreamOperations` right after the message insert (fire-and-forget, never throws). It iterates `claimVerificationResult.attestations`, fills the citation type from the source's `type`, fills `chunk_id` / `knowledge_item_id` from the source, and **also** emits one unverifiable fallback row per source that the verifier dropped (so the chat surface always has a row to render).

#### 3.3.4 Modify: `src/server/services/llm-streaming-service.ts`

After governance + claim verification + the `sources.length = 0; sources.push(...)` reset, capture the post-final `sources` and the `attestations`, then call `claimAttestationService.persistAll`. This is the **only** place attestations are produced, so the surface area is small.

```ts
const finalSources = [...sources];
const attRows: ClaimAttestationInput[] = [];
for (let i = 0; i < finalSources.length; i++) {
  const c = finalSources[i];
  const a = claimVerificationResult?.attestations.find(x => x.citation_index === i);
  attRows.push({
    messageId: assistantInsertedId,
    citationIndex: i,
    citationType: (c.type ?? 'knowledge') as ClaimAttestationInput['citationType'],
    spanStart: a?.span_start ?? 0,
    spanEnd: a?.span_end ?? 0,
    spanText: a ? (fullContent.slice(a.span_start ?? 0, a.span_end ?? 0) ?? '') : '',
    verdict: a?.verdict ?? 'unverifiable',
    confidence: a?.confidence ?? 0,
    verifierModel: options.claimVerificationConfig?.model ?? '',
    rationale: a?.rationale ?? '',
    chunkId: c.chunk_id ?? null,
    knowledgeItemId: c.knowledge_item_id ?? null,
    productId: c.product_id ?? null,
    sizeChartId: c.size_chart_id ?? null,
  });
}
claimAttestationService.persistAll(attRows).catch(err => logger.api.warn('claim-attestation-persist-failed', { error: err }));
```

#### 3.3.5 Tests

- `claim-support-verifier.test.ts` updates: every existing assertion gains `attestations: [...]`. New tests assert `validateSpan` rejects negative / out-of-range / mismatched-substring spans.
- New file: `claim-attestation-service.test.ts`. Asserts `persistAll` swallows errors, `getByMessageIds` returns an empty map for unknown ids.
- Modify: `route.max-turns.test.ts` mock of `ClaimAttestationService` (added as `vi.mock`) — assert `persistAll` is NOT called when the route is blocked by max_turns.

#### 3.3.6 Acceptance criteria (phase 3)

- Every assistant message with non-empty `Message.sources` produces one `claim_attestations` row per source.
- Span coordinates always satisfy `0 <= span_start <= span_end <= reply_length` and `reply.slice(span_start, span_end)` matches `span_text`.
- A `verifierModel = ''` row exists only when no verifier is configured; in that case `verdict = 'unverifiable'`.

#### 3.3.7 Rollback

Drop the `claim_attestations` table; remove the `persistAll` call site; revert the verifier prompt. No data loss elsewhere.

---

### Phase 4 — Product & size-chart first-class evidence records

**Goal**: orchestrator emits `citations: [...]` for product / size-chart contexts when hash-verification passes.

#### 3.4.1 Modify: `src/server/services/retrieval-orchestrator.ts`

Replace the current short-circuit in `buildProductBundle` and `buildSizeChartBundle` with delegations to the new evidence services:

```ts
private async buildProductBundle(...): Promise<EvidenceBundle> {
  const productCitations = await this.productEvidence.verify(result);
  return {
    candidates: [],
    accepted: productCitations,                       // accepted = hash-verified product citations
    citations: productCitations.map(c => toCitationItem(c)),
    trace: { ... provenanceVersion: 2 ... },
  };
}
```

`EvidenceItem` and `CitationItem` gain an optional `product_id` / `size_chart_id` field. `PublicCitationItem` (in `llm-streaming-service.ts`) mirrors this.

The orchestrator **never** calls into Supabase directly — it delegates to the two new evidence services (§3.4.2, §3.4.3) which own the hash comparison. If a service returns `[]`, `citations: []` is preserved (fail-closed).

#### 3.4.2 New file: `src/server/services/product-evidence-service.ts`

```ts
export interface ProductEvidenceItem {
  product_id: string;
  sku: string;
  matched_field: 'name' | 'sku' | 'category' | 'description' | 'specifications';
  evidence_excerpt: string;          // ≤ 240 chars from the formatted product text the LLM saw
  content_hash_at_citation: string;  // buildProductContentHash(row) at the moment of citation
  score: number;                     // reuse knowledge search score conventions
}

export class ProductEvidenceService {
  async verify(productContext: string, matchedIds: string[]): Promise<ProductEvidenceItem[]>;
}
```

`verify` reads the current `product_details` rows for the given IDs, recomputes `buildProductContentHash` for each, and compares against the hash that was baked into the LLM context (this hash is derived deterministically from the same inputs — see §3.4.4). Rows where the hash matches return a `ProductEvidenceItem`. Rows where the hash mismatches return nothing and log a degradation reason `product_hash_mismatch`.

The `evidence_excerpt` is a ≤ 240-char substring of `formatProductForLLM(product)` anchored to the matched field (e.g. for `matched_field: 'sku'`, the excerpt starts at `【SKU】${sku}`). The excerpt is what the chat surface displays in the SourcePanel.

#### 3.4.3 New file: `src/server/services/size-chart-evidence-service.ts`

Mirror of §3.4.2 using `buildSizeChartContentHash` and `buildSizeChartTextContent`. `matched_field` enum: `'name' | 'chart_type' | 'category' | 'size_columns' | 'size_rows'`. A new hash mismatch reason `size_chart_hash_mismatch` joins the existing degradation reasons.

#### 3.4.4 Modify: `src/server/services/product-detail-service.ts` and `src/server/services/size-chart-service.ts`

The orchestrator must pass to the evidence services the hash that was actually fed to the LLM. Today, `searchProductsForLLM` / `searchSizeChartsForLLM` build the LLM context from `formatProductForLLM(product)` / `buildSizeChartTextContent(chart)`, but the hash for citation comparison lives in the `content_hash` column of the row, which the orchestrator never sees. Two changes:

1. `searchProductsForLLM` and `searchSizeChartsForLLM` return an additional `contextHashes: string[]` array — the `buildProductContentHash` / `buildSizeChartContentHash` of each row that contributed text to the LLM context, in the same order as the formatted rows.
2. The orchestrator passes `contextHashes` into the evidence services. The evidence service recomputes the hash for the **current** row state and compares against the stored `contextHashes[i]`. If they match, the citation is attested; if they do not, hash mismatch.

This is the design that lets the system say "the SKU was X at the time of citation, and the SKU is still X" — without it, the orchestrator cannot distinguish a row that was edited from a row that wasn't.

#### 3.4.5 Modify: `CitationItem`, `PublicCitationItem`, `EvidenceItem`

Add the optional fields (TypeScript only, no DB schema change since they piggy-back on `claim_attestations`).

#### 3.4.6 Tests

New file: `product-evidence-service.test.ts`:
- Hash matches → returns the citation.
- Hash mismatch → returns `[]`, logs degradation.
- Empty `matchedIds` → returns `[]`.
- Repository failure → returns `[]` and logs (no throw).

Mirror: `size-chart-evidence-service.test.ts`.

Modify: `retrieval-orchestrator.test.ts`:
- A new test asserts `evidence.citations` now contains product entries when hash matches.
- A new test asserts `evidence.citations` is empty when hash mismatches (fail-closed).
- Degradation reasons include `product_hash_mismatch` and `size_chart_hash_mismatch` in the trace.

#### 3.4.7 Acceptance criteria (phase 4)

- A SKU lookup that hits the database and whose hash matches the LLM context produces a `Message.sources` entry of `type: 'product'` with `product_id`, `sku`, `matched_field`, `evidence_excerpt`.
- A SKU lookup whose row was edited between the LLM context build and the citation step produces no `product` entry, and the trace's `degradationReasons` contains `product_hash_mismatch`.
- Same shape for size-chart entries.

#### 3.4.8 Rollback

Revert the orchestrator to its current short-circuit (`citations: []` for product / size-chart). Revert the type field additions. Revert the `contextHashes` return values. Existing tests must continue to pass.

---

### Phase 5 — Trusted pending-choice signal & span-aware chat surface

**Goal**: numbered-choice gating uses an explicit `pending_choice` marker; `SourcePanel` highlights the supported span.

#### 3.5.1 New file: `src/server/services/pending-choice-service.ts`

Pure helpers plus a thin per-conversation cache. The cache is a `Map<conversationId, PendingChoice>` with an LRU cap of 256. It is process-local (matches the existing in-memory sim route patterns). The cache exposes:

```ts
export interface PendingChoice {
  questionId: string;             // server-generated uuid per marker
  options: Array<{ id: string; label: string }>;
  createdAtMs: number;
  expiresAtMs: number;            // createdAtMs + 600_000
}

export class PendingChoiceService {
  set(conversationId: string, choice: PendingChoice): void;
  get(conversationId: string, nowMs: number): PendingChoice | null;
  clear(conversationId: string): void;
}
```

The service is a singleton (no Supabase dependency). It is intentionally NOT persisted to DB in this phase; pending choices are conversational artifacts that survive only as long as the session. If the user refreshes the page, the pending choice is lost — that is acceptable for the numbered-choice use case.

#### 3.5.2 Modify: `src/server/services/llm-streaming-service.ts`

In the system prompt builder (`buildLLMMessages`), add a new section after `SUB_AGENT_DELEGATION_PROMPT`:

```
【结构化选项提问】
当你需要向用户呈现一组有限的、互斥的选项时（例如"请选择退款原因"），请在回复最末尾插入一个 [PENDING_CHOICE] 标记，格式如下：
[PENDING_CHOICE]{"options":[{"id":"1","label":"商品瑕疵"},{"id":"2","label":"尺寸不符"},{"id":"3","label":"其他"}]}[/PENDING_CHOICE]
规则：
- 选项 id 必须唯一且简短（数字或简短字符串）。
- 选项 label 是用户可见的选项文本（≤ 30 字）。
- 同一回复中只能有一个 [PENDING_CHOICE] 标记。
- 标记应放在回复最末尾，不要放在正文中。
- 标记会被后端解析为结构化提问卡，前端会渲染为按钮面板。
```

In `createStream`, after the LLM content is streamed and `stripInternalMarkers` runs, parse out the `[PENDING_CHOICE]` JSON, build a `PendingChoice`, write it to `pendingChoiceService.set(conversationId, choice)`, attach it to the SSE done event:

```ts
const pendingMarkerMatch = /\[PENDING_CHOICE\](\{[\s\S]*?\})\[\/PENDING_CHOICE\]/.exec(rawFullContent);
if (pendingMarkerMatch) {
  try {
    const parsed = JSON.parse(pendingMarkerMatch[1]);
    const choice: PendingChoice = {
      questionId: crypto.randomUUID(),
      options: parsed.options ?? [],
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 600_000,
    };
    pendingChoiceService.set(conversationId, choice);
    donePayload.pending_choice = choice;          // sent via SSE
  } catch (err) {
    logger.agent.warn('[LLMStreamingService] Failed to parse pending_choice marker', { error: err });
  }
}
```

`donePayload.pending_choice` is a new field on the SSE done event. `chat-page.tsx` reads it.

#### 3.5.3 Modify: `src/server/services/retrieval-gating-service.ts`

Replace `isAfterNumberedChoices` with a new signature:

```ts
export interface RetrievalGateOptions {
  skipDeterministic?: boolean;
  pendingChoice?: PendingChoice | null;
}

shouldRetrieve(
  userMessage: string,
  recentMessages: Array<{ role: string; content: string }>,
  options?: RetrievalGateOptions,
): RetrievalGateDecision
```

The numeric-only check is rewritten:

```ts
const pending = options?.pendingChoice;
if (pending && Date.now() < pending.expiresAtMs) {
  const trimmedQuery = trimmed.replace(/^[\s,，。、]+|[\s,，。、]+$/g, '');
  const matchedOption = pending.options.find(o => o.id === trimmedQuery || o.label === trimmedQuery);
  if (matchedOption) {
    return { action: 'retrieve', reasonCode: 'pending_choice_answer', effectiveQuery: matchedOption.label, confidence: 0.95 };
  }
}
if (NUMERIC_ONLY_PATTERN.test(trimmed)) {
  return { action: 'skip', reasonCode: 'numeric_only', effectiveQuery: trimmed };
}
```

The text-shape heuristic `isAfterNumberedChoices` is deleted entirely.

`ReasonCode` gains `'pending_choice_answer'`. The `'answerable'` / `'underspecified'` / etc. codes are unchanged.

#### 3.5.4 Modify: `src/server/services/retrieval-orchestrator.ts`

Pass `pendingChoice` through to `gating.shouldRetrieve`:

```ts
const decision = this.gating.shouldRetrieve(userMessage, recentMessages, {
  pendingChoice: pendingChoiceService.get(conversationId ?? '', Date.now()),
});
```

The `retrieve()` method gains an optional `conversationId` parameter so the orchestrator can look up the pending choice.

#### 3.5.5 Modify: `src/app/api/conversations/[id]/messages/route.ts` and `src/app/api/simulations/[id]/messages/route.ts`

Both routes pass `conversationId` into `orchestrator.retrieve(...)`. The conversations route already has `conversationId`. The simulation route already has it (as `conversationId`).

#### 3.5.6 Modify: `src/app/api/conversations/[id]/messages/route.max-turns.test.ts` and new test

Add a `pending-choice-service.test.ts` that asserts:
- `set` then `get` returns the choice while within TTL.
- `get` returns `null` after TTL.
- `clear` removes the entry.
- LRU eviction at 256 entries preserves the most recently used.

Add a new gating test that asserts the new `pending_choice_answer` code path.

#### 3.5.7 Modify: `src/components/chat/chat-window.tsx`

In the SSE done handler (where `streamingSources` etc. are committed to `tabStates`), also commit `done.pending_choice` into a per-tab `pendingChoice` state. The state is consumed by an inline `PendingChoicePanel` that renders the options as buttons; clicking an option sends `option.id` via `onSend`. The panel auto-hides 10 minutes after `createdAtMs`. If `pending_choice` is absent, the panel hides.

The numeric-only heuristic in the **chat-page input** (if any) is also removed; the input now trusts the `pendingChoice` state — when the user types `"1"`, the page-level `onSend` no longer mutates or filters the value; the orchestrator decides.

#### 3.5.8 Modify: `src/components/chat/source-panel.tsx`

Render a "支持的片段" row per citation. The row shows:

```tsx
<div className="text-[11px] text-muted-foreground mb-1">支持片段</div>
<pre className={verdictClassName(verdict)}>
  {span_text || <span className="italic text-muted-foreground">无法定位到具体片段</span>}
</pre>
```

The verdict class names: `entailed → bg-emerald-50`, `contradicted → bg-rose-50`, `ambiguous → bg-amber-50`, `unverifiable → bg-muted`. The chat-page parent passes the attestation array down via a new prop `attestations: ClaimAttestationRow[]`. `chat-window.tsx` fetches them via a new `GET /api/conversations/[id]/messages/[msgId]/attestations` route (see §3.5.9).

#### 3.5.9 New route: `src/app/api/conversations/[id]/messages/[msgId]/attestations/route.ts`

GET handler that returns the attestations for a single message. Restricted to agents / admin / the message's owner. Returns `404` when the trace is missing. The route is **NOT** mounted in the simulation flow; simulation's SourcePanel fetches via `useEffect` only when the conversation has persisted sources (sims do not write attestations in phase 1; phase 5 only adds this for the production path).

#### 3.5.10 Tests

- `pending-choice-service.test.ts` (above)
- Update `retrieval-gating.test.ts`:
  - Existing "1" tests: rewrite the positive path to use `pendingChoice` instead of text-shape heuristic. The negative path (no pending choice, "1" alone) is unchanged.
- New `source-panel.attestation.test.tsx`: renders a citation with `verdict: 'entailed'`, asserts the span is highlighted in emerald; renders a citation with `verdict: 'contradicted'`, asserts rose; renders a citation with `span_text: ''`, asserts the fallback "无法定位" appears.

#### 3.5.11 Acceptance criteria (phase 5)

- A user who asks `"1"` after the assistant emits a `[PENDING_CHOICE]` retrieves against the matched option's label.
- A user who types `"1"` with no pending choice still gets SKIP / numeric_only (existing behavior preserved).
- `SourcePanel` shows the supported span for every cited claim, color-keyed by verdict.
- The text-shape heuristic `isAfterNumberedChoices` is removed from the codebase (`grep -R "isAfterNumberedChoices" src/` returns no hits).

#### 3.5.12 Rollback

Revert the prompt section addition; revert the SSE `done.pending_choice` field; revert the chat-window `pendingChoice` state and panel; revert the SourcePanel attestation row; revert the gating service to take only `(query, recentMessages)`. The `pending-choice-service.ts` file can be deleted.

---

## 4. Files Touched (Summary)

### New files

| Path | Phase |
|------|-------|
| `supabase/migrations/20260713_retrieval_traces.sql` | 1 |
| `src/server/services/retrieval-trace-service.ts` | 1 |
| `src/server/repositories/retrieval-trace-repository.ts` | 1 |
| `src/server/services/retrieval-trace-service.test.ts` | 1 |
| `src/app/api/conversations/[id]/messages/route.trace.test.ts` | 1 |
| `src/server/services/provenance-governance.ts` | 2 |
| `src/server/services/provenance-governance.test.ts` | 2 |
| `supabase/migrations/20260713_provenance_v1_backfill.sql` | 2 |
| `supabase/migrations/20260713_claim_attestations.sql` | 3 |
| `src/server/services/claim-attestation-service.ts` | 3 |
| `src/server/services/claim-attestation-service.test.ts` | 3 |
| `src/server/services/product-evidence-service.ts` | 4 |
| `src/server/services/product-evidence-service.test.ts` | 4 |
| `src/server/services/size-chart-evidence-service.ts` | 4 |
| `src/server/services/size-chart-evidence-service.test.ts` | 4 |
| `src/server/services/pending-choice-service.ts` | 5 |
| `src/server/services/pending-choice-service.test.ts` | 5 |
| `src/app/api/conversations/[id]/messages/[msgId]/attestations/route.ts` | 5 |
| `src/components/chat/source-panel.attestation.test.tsx` | 5 |

### Modified files

| Path | Phase | Change |
|------|-------|--------|
| `src/server/services/llm-streaming-service.ts` | 1, 2, 3, 5 | thread `decision`/`evidence`/`startedAtMs`; governance call; persistAll call; `[PENDING_CHOICE]` marker parse; SSE done.pending_choice |
| `src/server/services/claim-support-verifier.ts` | 3 | verifier prompt + output schema + `validateSpan` |
| `src/server/services/retrieval-gating-service.ts` | 5 | remove `isAfterNumberedChoices`; add `pendingChoice` parameter; new reason code |
| `src/server/services/retrieval-orchestrator.ts` | 4, 5 | delegate product/size-chart to evidence services; pass `conversationId` for pending choice lookup; new optional citation fields |
| `src/server/services/product-detail-service.ts` | 4 | `searchProductsForLLM` returns `contextHashes` |
| `src/server/services/size-chart-service.ts` | 4 | `searchSizeChartsForLLM` returns `contextHashes` |
| `src/server/services/conversation-service.ts` | 1 | return id from `insertMessageAndReturn` (existing) |
| `src/server/repositories/conversation-repository.ts` | 1 | confirm `insertMessageAndReturn` shape (existing) |
| `src/app/api/conversations/[id]/messages/route.ts` | 1, 2, 5 | pass decision/evidence; `conversationId` into orchestrator |
| `src/app/api/conversations/[id]/messages/route.max-turns.test.ts` | 3 | mock ClaimAttestationService |
| `src/app/api/simulations/[id]/messages/route.ts` | 1, 2, 5 | pass decision/evidence; `conversationId` into orchestrator |
| `src/components/chat/chat-window.tsx` | 5 | pending choice state + panel; consume SSE `done.pending_choice` |
| `src/components/chat/source-panel.tsx` | 5 | supported-span row, color-keyed by verdict |
| `src/components/chat/chat-page.tsx` | 5 | wire attestations fetcher; gate UI input on pending choice |

---

## 5. Acceptance Across All Phases

End-to-end test plan (run after each phase; full pass before release):

1. **Unit**: `pnpm test:run` — all suites green (existing 21 files / 172 tests + new suites).
2. **Type**: `pnpm exec tsc --noEmit --project tsconfig.json` — zero errors.
3. **Lint**: `pnpm exec eslint --quiet <modified paths>` — zero errors.
4. **Diff whitespace**: `git diff --check` — zero trailing-whitespace on touched files.
5. **Migration**: `pnpm exec supabase db reset` (local), then `pnpm exec supabase db push` against the staging project; verify `retrieval_traces`, `claim_attestations` exist; verify `provenance_v1_backfill` rows count matches `SELECT count(*) FROM messages WHERE sources @> '[{"provenanceVersion": 1}]'::jsonb`.
6. **Live integration smoke** (staging env):
   - Send a known answerable query → `retrieval_traces` row appears, `claim_attestations` rows appear, `Message.sources` reflects the governed citation set.
   - Send `"1"` with no pending choice → `decision_reason_code = 'numeric_only'`, `Message.sources = []`.
   - Send `"1"` after a `[PENDING_CHOICE]` reply → `decision_reason_code = 'pending_choice_answer'`, retrieval runs against the option label.
   - Edit a product row between the LLM context build and the citation step → product entry is absent from `Message.sources`, `degradationReasons` contains `product_hash_mismatch`.
7. **Audit**: `SELECT count(*) FROM claim_attestations WHERE verdict = 'contradicted'` should be ≤ 5% of total over a representative 7-day window. The number is informational; it is **not** an automatic rollback trigger.
8. **Retention**: A documented operational migration (`docs/operations/2026-07-13-retrieval-trace-retention.md` — written separately, not part of this plan) drops `retrieval_traces` rows older than 30 days. The plan does NOT include the retention migration; the table is append-only within the project lifecycle.

---

## 6. Out of Scope (Deferred)

- **P4 calibration, shadow mode, canary rollout** — deferred until labeled evaluation data exists and a shadow-mode harness is built on top of `retrieval_traces`.
- **Cross-language claim verifier** — the verifier remains auxiliary LLM only; deterministic (rule-based) verification is a future enhancement.
- **Citation stability audit** beyond chunk_id / content_hash — e.g. tracking edits to a `knowledge_item`'s category that affect future hit scores. Tracked in a separate ticket.
- **Persisting `pending_choice` across sessions** — pending choices are conversational artifacts, not durable state.
- **Span coordinates for tool / sub-agent / auto_reply citations** — the chat surface renders the supported-span row only for knowledge / product / size-chart citations in phase 5. Extending the row to other types requires verifier changes that are out of scope.

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation | Owner |
|------|--------|------------|-------|
| The `retrieval_traces` table grows quickly (one row per assistant message). | Disk + index bloat within weeks. | 30-day retention migration documented; `effective_query_digest` index stays small because of fixed prefix; no PII in `effective_query` (only the LLM-bound effective query, no raw user PII). | Deployment |
| The `provenance_v1_backfill` migration runs slowly on a 90-day window with millions of messages. | Long-running migration blocks deploys. | `LIMIT 500` batches with `FOR UPDATE SKIP LOCKED`; idempotent via per-`(message_id, source_index)` uniqueness; the migration is non-destructive (writes new rows only). | DBA / migration author |
| Span coordinates from the auxiliary LLM may be inconsistent across calls. | The `SourcePanel` would render a wrong span. | `validateSpan` enforces `(start, end) ⊂ reply` and substring equality; invalid spans become `unverifiable` with empty `span_text`. | Phase 3 |
| The `[PENDING_CHOICE]` marker is hallucinated by the LLM with malformed JSON. | The SSE done event includes broken data. | `JSON.parse` is wrapped in `try / catch`; malformed markers are logged and dropped; the SSE `done.pending_choice` field is omitted. | Phase 5 |
| The product / size-chart hash comparison may produce false negatives after legitimate normalization (whitespace, NFC). | Real edits get reported as hash mismatches and the citation is suppressed. | The hash function (`buildProductContentHash` / `buildSizeChartContentHash`) is already used for dedup at write time; phase 4 uses the same function at read time. The chat surface degrades gracefully — `evidence_excerpt` is still rendered in `ProductDetailPanel` / `SizeChartPanel` panels but the `SourcePanel` row is hidden. | Phase 4 |
| The orchestrator's new optional `product_id` / `size_chart_id` fields collide with the existing `knowledge_item_id` semantic. | Frontend code that assumes `knowledge_item_id` exists on every citation might break. | Both fields are optional. The `SourcePanel` reads `chunk_id` / `knowledge_item_id` first, falls back to `product_id` / `size_chart_id`. The frontend fallback is tested in `source-panel.attestation.test.tsx`. | Phase 5 |
| The legacy `isAfterNumberedChoices` removal may regress edge cases. | A real numbered-choice context (e.g. from another product / external integration) is no longer recognized. | The explicit `[PENDING_CHOICE]` marker covers the in-app flow. External integrations that never emitted the marker lose the heuristic; we document this in the chat-page release notes. Operators can re-enable the heuristic by setting a feature flag `LEGACY_NUMBERED_HEURISTIC=true` (default false). | Phase 5 |

---

## 8. P4 Boundary (Deferred)

P4 will consume:

- `retrieval_traces` rows for labeled calibration dataset construction.
- `claim_attestations` rows to compute "claim-verified accuracy" per rerank backend.
- `governed` citations in `Message.sources` to compute "published citations per turn" without re-running governance.

P4 will produce:

- Threshold sweeps over `minScore` and `rerankBackend`.
- Shadow-mode harness comparing two `RetrievalOrchestrator` configurations.
- Canary rollout playbook.

No P3 surface changes; P4 reads only.

---

## 9. Open Questions

None. All five user-listed gaps have a single concrete plan and contract. The plan is internally consistent and respects the existing P2 chunk-identity migration and the existing privilege hardening in `20260713_harden_rpc_search_path_and_privs.sql`.
# RAG Retrieval & Citation Closure — Implementation Plan

**Date**: 2026-07-13
**Scope**: P0 (stop false citations) + P1 (shared contract) + P2 (bounded query rewrite, claim verification, stable chunk identity, entrypoint unification)
**Status**: P0 + P1 + P2 implemented; P3–P4 deferred

## Root Cause

The simulation/test path produced citations for non-query inputs (e.g. `"1"`)
because three architectural defects compounded:

1. **No query gate.** Every user message — including digits, punctuation,
   acknowledgements — triggered parallel knowledge / product / size-chart
   retrieval. The nearest vector neighbor was accepted unconditionally.
2. **Threshold misalignment.** `DEFAULT_KNOWLEDGE_MIN_SCORE` was 0.5 while the
   declared project default in `HTTP.KNOWLEDGE_MIN_SCORE` was 0.75. On
   settings-read failure the runtime silently dropped to 0.5.
3. **Dual citation path.** Two independent code paths merged raw knowledge
   candidates into `Message.sources`:
   - `simulations/[id]/messages/route.ts` ran its own parallel search and
     merged the result into the assistant message.
   - `LLMStreamingService` pushed `options.knowledgeSources` straight into
     `sources` whenever the LLM context was non-empty, with no verification
     that the LLM actually used the passages.

Auto-reply was also contaminated: when an auto-reply rule matched, the route
appended the unrelated KB search result to `sources`, so the user saw a refund
policy cited under a greeting or "1".

## Behavior Contract (After Fix)

### Query gate (deterministic, conversation-aware)

`RetrievalGatingService.shouldRetrieve(query, recentMessages)` returns
`{ action, reasonCode, effectiveQuery, requiredSlots?, confidence? }`.

| Input | Action | ReasonCode |
|-------|--------|------------|
| `""`, whitespace-only | skip | empty |
| `"."`, `","`, `"!"`, etc. | skip | punctuation_only |
| `"1"`, `"2"`, etc. (no context) | skip | numeric_only |
| `"1"` (after assistant's numbered choices) | **retrieve** | answerable |
| `"好的"`, `"嗯"`, `"谢谢"`, `"确认"`, `"收到"` | skip | acknowledgement |
| `"你好"`, `"hi"`, `"hello"` | skip | greeting |
| `"😊"` | skip | emoji_only |
| `"/help"`, `{"action":"..."}` | skip | ui_control |
| `"退款"` (real but vague) | retrieve | underspecified (confidence 0.4) |
| `"签收后第六天可以无理由退货吗？"` | retrieve | answerable (confidence 0.8) |
| `"今天天气怎么样？"` | retrieve | out_of_scope (confidence 0.2) |

Skip ⇒ zero retrieval, zero citations.

### Citation separation

`EvidenceBundle` exposes three distinct fields:

| Field | Audience | Notes |
|-------|----------|-------|
| `candidates` | Internal diagnostic only | Always present, may be empty. **Never** stored in `Message.sources`. |
| `accepted` | LLM context only | Filtered by evidence grading (min_score threshold). |
| `citations` | Public `Message.sources` | Relevance-graded knowledge sources only when a real reranker succeeded. Product/size-chart context is withheld until independently verifiable. |

Provenance version `2` is stamped on every citation. Legacy citations
remain at `provenanceVersion: 1` (read-only compatibility, no backfill).

### Rerank fallback safety

`EvidenceBundle.trace.rerankDegraded` is `true` whenever a real cross-encoder
reranker (`BGE_RERANK_API_URL` / `COHERE_API_KEY` / `RERANK_API_URL`) is not
configured **or a configured backend fails and falls back to mock scoring**.
Mock scores are tagged `scoreOrigin: 'mock'`, never `'reranker'`. Citation
policy fails closed: degraded reranker keeps candidates for internal generation
and diagnostics, but public knowledge citations are empty. A successful real
reranker still establishes relevance only; claim-level attribution remains P3.

### Auto-reply isolation

When `AutoReplyService.matchReply` returns a hit, the assistant message's
`sources` is **only** `[{ type: 'auto_reply', keyword }]`. The orchestrator's
knowledge search result is **not** merged.

### Default threshold alignment

`DEFAULT_KNOWLEDGE_MIN_SCORE` in `knowledge-search-service.ts` and
`HybridSearchService.DEFAULT_CONFIG.minScoreThreshold` both use
`HTTP.KNOWLEDGE_MIN_SCORE` (`0.75`). Runtime fallback paths now match the
declared project default.

### Persistence compatibility

- `Message.sources` stays the canonical public field (no schema migration).
- `provenanceVersion` is added inside citation objects (not as a column).
- Diagnostic trace stays in-memory on the orchestrator's response; not yet
  stored (P3 deliverable, requires bounded trace retention).

### Claim verification (P2)

`LLMStreamingService.createStream` accepts a `claimVerificationConfig` and
canonical `evidenceCitations`. After the streamed response body is finalized,
`ClaimSupportVerifier` runs an auxiliary LLM check that extracts factual
claims from the response and judges whether each is entailed by a cited
chunk. Only `factual=true AND verdict=entailed AND confidence>=threshold`
relationships survive; non-knowledge sources (tool, delegation, auto-reply)
are untouched. Verification runs in 4s (rewrite) / 6s (verify) hard timeouts
and fails closed on any JSON parse error, timeout, unknown ID, or
provider error — clearing all knowledge citations for the message.

### Bounded query rewrite (P2)

`QueryRewriteService` runs at most once per retrieval turn. Rewrite is only
attempted when first-pass `accepted` is empty AND the reranker is real
(`rerankDegraded=false`). The same fail-closed principle applies: an empty,
identical-to-original, or invalid rewritten query is rejected and the first
results are preserved.

### Stable chunk identity (P2)

`chunk_id`, `chunk_index`, and `content_hash` propagate from the Supabase RPC
through `HybridSearchService`, the orchestrator's `CitationItem`, the
stream's `PublicCitationItem`, and the public `Message.sources`. Feedback
records (`knowledge_feedback`) and the `SourcePanel` use `chunk_id ?? knowledge_item_id ?? index` as a stable key.

### Entry-point alignment (P2)

`/api/conversations/[id]/messages`, `/api/simulations/[id]/messages`, and the
Gorgias sync service all consume the verified `lastDoneChunk.sources` and
`confidence` from the same `LLMStreamingService`. The simulation route no
longer recalculates confidence from raw `orchestratorCitations`, which would
bypass the verifier. On stream timeout the route clears knowledge citations
rather than publishing unverified KB sources for an incomplete answer.

## Modified Files

| File | Change |
|------|--------|
| `src/server/services/retrieval-gating-service.ts` | **NEW** — deterministic SKIP/RETRIEVE/CLARIFY gate |
| `src/server/services/retrieval-orchestrator.ts` | **NEW** — shared contract `EvidenceBundle` + `RetrievalDecision` |
| `src/server/services/retrieval-gating.test.ts` | **NEW** — 23 tests covering gate + orchestrator contract |
| `src/server/services/knowledge-search-service.ts` | `DEFAULT_KNOWLEDGE_MIN_SCORE`: 0.5 → 0.75 (aligns with project default); maps `chunk_id`/`chunk_index`/`content_hash` from `HybridSearchResult` |
| `src/app/api/simulations/[id]/messages/route.ts` | Replace parallel search + raw source merge with `RetrievalOrchestrator`; auto-reply no longer attaches KB sources; save claim-verified citations only; timeout path clears KB sources |
| `supabase/migrations/match_knowledge_items_v2.sql` | **NEW** — returns `chunk_id`, `chunk_index`, `content_hash` explicitly; NULL chunk_id when matched at parent-item level |

### P2 Additions

| File | Change |
|------|--------|
| `src/server/services/auxiliary-llm-service.ts` | **NEW** — structured JSON-call helper with JSON/text retry, strict parsing, validator, hard timeouts (rewrite 4s / verify 6s), secret-safe logging |
| `src/server/services/auxiliary-llm-service.test.ts` | **NEW** — 18 tests covering JSON mode, JSON fallback, empty/no-choice/timeout/invalid-JSON/validator-reject, retry limit, timeout clamping |
| `src/server/services/query-rewrite-service.ts` | **NEW** — bounded LLM rewrite: at most 1 rewrite per turn, only when accepted=0 and real reranker available; normalization, dedup, and truncation |
| `src/server/services/query-rewrite-service.test.ts` | **NEW** — 20 tests covering rewriteDecision (skip/no_rewrite/reranker_degraded), rewriteQuery (success/empty/timeout), dedup, normalization, truncation |
| `src/server/services/claim-support-verifier.ts` | **NEW** — fail-closed claim verifier: extracts factual claims from LLM response, maps to chunk_id-pinned sources via internal S IDs, only keeps `factual=true + entailed + confidence>=threshold` |
| `src/server/services/claim-support-verifier.test.ts` | **NEW** — 32 tests: single/multi claim-source, partial/contradicted/unknown/no-factual-claims, unknown IDs, fabricated text, invalid JSON, timeout, provider error, confidence threshold, never-add-sources |
| `src/server/services/llm-streaming-service.ts` | Extended: claim verification runs AFTER fullContent is finalized but BEFORE confidence calculation; verified-only citations flow to SSE done.sources and DB persistence |
| `src/app/api/conversations/[id]/messages/route.ts` | Passes `evidenceCitations` and `claimVerificationConfig` to `LLMStreamingService.createStream()` |
| `src/app/api/simulations/[id]/messages/route.ts` | Uses `lastDoneChunk.sources` and `lastDoneChunk.confidence` from verified SSE done event; timeout path clears KB citations |
| `src/storage/database/shared/schema.ts` | `knowledge_feedback` table extended: `chunk_id`, `chunk_index`, `content_hash` |
| `supabase/migrations/20260713_rag_chunk_identity_feedback.sql` | **NEW** — adds chunk identity columns to `knowledge_feedback` with indexes |
| `src/server/repositories/knowledge-feedback-repository.ts` | Extended types and `create()` for chunk identity fields |
| `src/app/api/knowledge/feedback/route.ts` | Accepts and passes `chunk_id`, `chunk_index`, `content_hash` |
| `src/lib/types.ts` | `Message.sources` / `SimulationMessage.sources` include chunk identity fields |
| `src/components/chat/source-panel.tsx` | `SourceItem` extended; `submitSourceFeedback` uses `chunk_id ?? knowledge_item_id ?? index` as stable key |

## Test Commands & Results

Final verification commands:

```text
pnpm test:run
pnpm exec tsc --noEmit --project tsconfig.json
pnpm exec eslint --quiet <RAG files>
git diff --check
```

Final result on 2026-07-13: 35 test files and 289 tests passed. TypeScript
(`pnpm ts-check`) exited with code 0 across the entire repository. Focused
ESLint on the P2 services and the simulation route exited with code 0 with
zero warnings. The P2 service suite alone (auxiliary-llm-service,
query-rewrite-service, claim-support-verifier) ran 52 tests, all passing.

## Explicitly Out of Scope (Deferred Work)

- **P3 Trace persistence**: trace is logged but not persisted (no migration yet).
- **P3 History v1 backfill**: existing messages with `provenanceVersion: 1` are not backfilled; new trusted citations emit v2.
- **P4 Calibration / shadow mode / canary**: deferred until labeled evaluation data and the claim verifier are available.

## Risks & Remaining Work

| Risk | Mitigation | Owner |
|------|------------|-------|
| No external reranker is configured in `.env` | Hybrid retrieval still supplies internal generation context, but public knowledge citations remain empty by design. Configure one adapter from `.env.example`. | Deployment |
| Query rewrite + claim verification add latency | Both use bounded auxiliary LLM calls (rewrite ≤4s, verifier ≤6s); verifier runs after LLM finishes so first-byte latency is unchanged. P95 tail latency for verification ≤2s. | Implemented |
| Claim verification may over-filter citations | Fail-closed on any JSON/parse error; only keeps entries with `factual=true AND verdict=entailed AND confidence>=threshold`. Non-knowledge sources are never affected. | Implemented |
| Stable chunk identity may not be available for all results | When `chunk_id` is NULL, the citation uses `knowledge_item_id` as fallback. KB feedback API records chunk-level fields when available. | Implemented |
| Remote Supabase migration not applied | The migration file `20260713_rag_chunk_identity_feedback.sql` exists locally and the existing `match_knowledge_items` RPC was already updated. Migration must be applied in the target environment before `chunk_id` propagation can take effect on `knowledge_feedback`. | Deployment |

## Reproduction (Before vs After)

Before: User in `/simulation` types `"1"`.
- Old code: parallel search → refund KB matched → `mergedSources` includes refund sources → panel shows refund as citation.
- Confidence: 0.5–0.95.

After: User in `/simulation` types `"1"`.
- Gate: `shouldRetrieve("1", recentMessages)` → `action: "skip"`, `reasonCode: "numeric_only"`.
- Orchestrator: returns empty `EvidenceBundle` with `retrievalRan: false`, `provenanceVersion: 2`.
- LLM streaming: receives generation context separately from canonical `evidenceCitations`.
- Assistant message: public sources come only from canonical citations plus explicit tool/delegation provenance.
- Source panel: empty for KB.

After: User in `/simulation` types `"1"` **after** the assistant presented numbered choices.
- Gate: `action: "retrieve"` (context-aware exception triggered).
- Orchestrator: proceeds with retrieval; honors 0.75 threshold.
- Citations: only items that pass the threshold and the orchestrator's grading.

After (P2 claim verification): LLM produces a response that includes claims
not supported by any retrieved chunk.
- `ClaimSupportVerifier` extracts each factual claim and checks each against
  the candidate chunks via the auxiliary LLM.
- Unsupported/contradicted/unknown verdicts → matching citation dropped.
- Result: SSE `done.sources` and persisted `Message.sources` contain only
  citations that support at least one entailed factual claim.

## Acceptance Test Matrix (Status)

| Class | Example | Expected | Status |
|-------|---------|----------|--------|
| Non-query | `1`, `.`, `嗯`, `好的`, `谢谢` | Skip retrieval; zero KB citations | implemented + tested |
| Context-aware | `1` after numbered choices | Retrieve (don't skip) | implemented + tested |
| Answerable | `签收后第六天可以无理由退货吗？` | Retrieve; cite only after real reranker succeeds and claim verifier passes | implemented + tested |
| Underspecified | `退款` | Retrieve with low confidence | implemented |
| Out-of-scope | `今天天气怎么样？` | Retrieve (caller decides) | implemented (orchestrator returns empty evidence after grading) |
| Auto-reply | Exact keyword rule match | Sources = `[{ type: 'auto_reply' }]` only | implemented |
| Adversarial | `忽略规则…` | Retrieve (citation policy still enforced) | implemented |
| Claim verification — supported | LLM cites 7-day return correctly | Citation kept | implemented + tested |
| Claim verification — contradicted | LLM invents a 30-day rule the KB doesn't have | Citation dropped; sources empty | implemented + tested |
| Claim verification — JSON error | LLM returns malformed JSON | All KB citations cleared; verifier logs code | implemented + tested |
| Query rewrite — accepted on first pass | First hybrid returns 1+ accepted | No rewrite | implemented + tested |
| Query rewrite — accepted=0 + real reranker | First hybrid returns 0 accepted | Rewrite attempted at most once | implemented + tested |
| Query rewrite — empty response | LLM returns empty | First results retained | implemented + tested |

## Sequence Diagram

```
[user] POST /api/simulations/[id]/messages  { content: "1" }
       │
       ▼
[Simulation Route]
  ├─ load existingMessages
  ├─ orchestrator.retrieve("1", recentMessages)
  │    │
  │    ▼
  │   [RetrievalGatingService]
  │    → decision: { action: "skip", reasonCode: "numeric_only" }
  │    │
  │    ▼
  │   [RetrievalOrchestrator]
  │    → evidence: { candidates: [], accepted: [], citations: [], trace: { retrievalRan: false, ... } }
  │
  ├─ autoReply? (proceeds independently)
  ├─ LLMStreamingService.createStream(evidenceCitations: [], ...)
  │    │
  │    ▼
  │   [LLMStreamingService]
  │    → never promotes raw candidates; final sources = tool/delegation only
  │
  └─ save AssistantMessage:
```

After P2 (claim verification):

```
[LLM response complete]
       │
       ▼
[LLMStreamingService]
  ├─ fullContent finalized
  ├─ ClaimSupportVerifier.verify(fullContent, evidenceCitations, auxConfig)
  │     → extracts factual claims
  │     → auxiliary LLM judges entailment per (claim, source) pair
  │     → returns filtered citations
  ├─ if !ok → drop ALL knowledge citations; hasKnowledge=false; knowledgeConfidence=0
  └─ SSE done.sources = filtered citations;
     DB Message.sources = filtered citations (same array)
```
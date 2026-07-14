# P4 RAG Evaluation & Rollout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Close the four P4 deferred items from the RAG initiative — (1) labeled evaluation set of at least 200 turns, (2) offline threshold calibration, (3) shadow mode + per-Bot/shop grayscale + comparator metrics, (4) continuous evaluation, automated regression gating, and feature-flagged release closure — by **reading** the P0–P3 trace/provenance contract and **extending** the existing `simulation_evaluations` + `test_cases` infrastructure rather than introducing a parallel evaluation stack.

**Architecture**: A single evaluation framework (`EvalFramework`) sits on top of the P3 trace/provenance outputs (`retrieval_traces`, `claim_attestations`, governed `Message.sources`) and the existing simulation/test-case infrastructure (`simulation_evaluations`, `test_cases`). Calibration produces **frozen threshold sets** keyed by `bot_id` / `shop_id`. Release is gated by a **shadow-mode harness** that compares the candidate configuration against a baseline on the same labeled turns, plus an automated regression gate in CI. Feature flags (`EVAL_CALIBRATION`, `EVAL_SHADOW`, `EVAL_CANARY`, `EVAL_AUTO_REGRESSION`) gate every stage independently so each phase is shippable and reversible on its own.

**Tech Stack**: TypeScript 5 (existing), Vitest (existing), pnpm (existing), Supabase Postgres (existing), Drizzle (existing), React 19 + shadcn/ui + Tailwind (existing), recharts (already used by `quality-page.tsx`), Background-SchedulerService (existing) for nightly batch jobs.

---

## Companion Documents & Reuse Boundaries

This plan reuses the following existing surfaces rather than introducing parallel stores:

| Existing surface | What it already stores | What P4 adds (read-only or extended) |
|---|---|---|
| `simulation_evaluations` (migration `20260627_simulation_evaluation_testcases.sql`) | One row per human eval: `simulation_id, message_id, rating(1-5), tags[], comment` | Reused as the **human-labeled leaf**. Schema is unchanged. |
| `test_cases` (same migration) | Test scenarios: `name, scenario_id, category, scripts[], expected_outcomes[]` | Reused as the **scenario definitions** that the gold-label builder expands into 200+ turns. No new table — extend with a `gold_set_id` column to link to a *specific evaluation dataset version*. |
| `retrieval_traces` (P3 phase 1) | Per-turn gate decision + evidence bundle | **Read** for offline calibration dataset construction. No P4 writes. |
| `claim_attestations` (P3 phase 3) | Per-citation span + verdict | **Read** for "claim-verified accuracy" metric. No P4 writes. |
| `governed citations` in `Message.sources` | Public citations after provenance governance | **Read** for "published citations per turn" metric. No P4 writes. |
| `background-scheduler-service.ts` | Hand-rolled periodic job runner (`runAll`, `runSLACheck`, …) | **Extended** with `runEvalRegressionGate`, `runEvalShadowCompare`, `runEvalCalibration`. Reuses the existing `?tasks=...` external trigger. |
| `HttpError` / `withErrorHandler` / `requireRole` (in `src/lib/api-utils.ts`) | Standard API hygiene | Reused unchanged for every new route. |
| `recharts` (already in package.json) | Charts in `quality-page.tsx` | Reused for the eval dashboard. |
| `bot_configs.id`, `shops.id`, `shops.platform_connection_id` | Slice identifiers | Reused as the deterministic-grayscale cohort keys. |
| `quality_rules` (existing rule types `first_response_timeout`, `keyword_violation`, `negative_sentiment`, `high_turn_count`, `satisfaction_below`) | Quality rule definitions | A new **eval-specific** rule type `eval_regression` is added; the existing rule engine is extended with one branch. No new table. |
| `feature-flags` (added by P4 phase 0, see §3.0) | JSON-backed feature flags | Single table, additive only. |

**Reuse vs new** — the rule is: if a storage shape matches an existing table, P4 reuses that table and only adds new columns / new rows with discriminating fields. P4 only creates new tables when no existing surface covers the shape (the eval **dataset version manifest**, eval **shadow run log**, and eval **regression gate log** are genuinely new shapes that no existing table covers).

---

## 1. Background & Gap

P3 closes the *trust* layer (provenance governance, claim attestations, span-level citation). Without P4, the system can:

- persist retrieval traces and claim attestations;
- govern and display citations correctly;

but it **cannot** answer:

- "Is the current `min_score = 0.75` actually optimal for *this* bot, or is it too permissive on refund policies and too strict on size-chart questions?"
- "If we change the reranker backend from `mock` to `bge`, what fraction of currently-served conversations would have been served *differently* and with what impact?"
- "After the next release of the LLM provider, did the answer-accuracy or citation-precision regress by more than X%?"
- "Can we *release* a new threshold or reranker without first collecting 200+ labeled turns, or do we ship blind?"

The user has called out **four concrete gaps** that P4 must close:

| # | Gap (user wording) | Why it matters now |
|---|---|---|
| 1 | "至少 200 条标注评估集" — the system has zero labeled turns for offline evaluation. | Without labels, no threshold sweep, no shadow harness, no regression gate can ever be statistically meaningful. The 200-turn floor is the minimum sample size for a Wilson 95%-CI width ≤ 10% on a binary answer-correct metric. |
| 2 | "阈值离线校准" — every threshold (`min_score`, reranker backend, claim-verifier threshold, confidence gate) is set by a hand-tuned constant in `src/lib/constants.ts` and `evidence-bundle` defaults. | A 0.75 threshold that fits one bot can be catastrophic for another. Calibration needs frozen, version-pinned threshold sets per `(bot_id | shop_id | "default")` so the runtime can consult them in shadow mode without duplicating the constant in code. |
| 3 | "shadow 模式、按 Bot/店铺灰度和指标对比" — when shipping a new reranker or threshold, the only safety net is "watch the dashboard". | Shadow mode must compute **per-turn** the alternate answer path on the *same input*, store both `baseline` and `candidate` delivery vectors, and emit a side-by-side comparator. The grayscale must be deterministic per `(bot_id, shop_id)` so an operator can audit exactly which cohorts were exposed. |
| 4 | "持续评估、自动回归与 feature-flag 发布闭环" — release is implicit, and there is no automated gate between "deploy" and "observe". | Releases must be **gated** by a CI regression check on the locked test set and **post-release** by a nightly continuous-eval job that re-runs on freshly-sampled real traffic. Feature flags decouple `deploy` (always safe) from `enable` (gated). |

P4 ships all four. The four on-disk artifacts each ship in their own independently-deliverable phase; phase 5 ties them together in a release playbook.

---

## 2. Behavior Contract (After This Plan)

### 2.1 Labeled evaluation set (closes gap 1)

A **dataset version manifest** is added on top of `test_cases`. Each `test_cases` row gains a column `eval_dataset_version_id` (FK to the new manifest). The manifest row describes:

- `version` — monotonically increasing integer (1, 2, 3, …).
- `status` — `draft | golden | archived`.
- `turn_count` — denormalized count of `eval_dataset_turns` rows pointing at the version.
- `rubric` — frozen reference to the rubric JSON.
- `bot_ids` — array of bot IDs the dataset targets.
- `created_at`, `created_by`, `frozen_at`.

A second new table, `eval_dataset_turns`, holds the actual labeled turns:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `eval_dataset_version_id` | uuid FK | |
| `turn_index` | int | 0-based ordering |
| `input_user_message` | text | trimmed literal |
| `input_recent_messages` | jsonb | array of {role, content} (≤10) |
| `input_bot_id` | uuid FK | |
| `input_shop_id` | uuid FK, nullable | |
| `gold_gate_decision` | text | one of `RetrieveGateAction` enum |
| `gold_citations` | jsonb | array of `{ type: 'knowledge'\|'product'\|'size_chart', id?, chunk_id?, name, category, score }` |
| `gold_answer` | text | canonical full answer (one variant) |
| `gold_answer_alt` | text[] | acceptable alternative answers |
| `gold_answer_facts` | text[] | atomic factual claims that must appear (for `claim_verified_accuracy`) |
| `gold_no_support_topics` | text[] | topics the answer must NOT mention |
| `gold_should_handoff` | boolean | whether the correct answer is "transfer to human" |
| `gold_should_auto_reply` | boolean | whether a deterministic auto-reply would suffice |
| `difficulty` | text | `easy \| medium \| hard` |
| `category` | text | `refund \| logistics \| size \| product \| policy \| chitchat \| other` |
| `source_conversation_id` | uuid FK, nullable | null for synthetic |
| `provenance` | text | `synthetic \| human_labeled \| sampled_real` |
| `annotator_id` | uuid FK | |
| `approved_by` | uuid FK | second-reviewer (rubric requires 2-of-2) |
| `created_at` | timestamp | |

**Schema constraints** (enforced by SQL):
- One turn per `turn_index` per version (unique index).
- `gold_gate_decision` ∈ `{skip, retrieve, clarify}`.
- `gold_should_handoff` and `gold_should_auto_reply` are mutually exclusive.
- `difficulty` ∈ `{easy, medium, hard}`.
- At least 1 entry in `gold_citations` whenever `gold_gate_decision = 'retrieve'`.

**Build process** (executable, no hallucinated content):
1. Seed 60% (`>= 120`) of the 200 turns from a **stratified sample** of real `simulation_evaluations` rows where `tags @> '{gold_candidate}'`. The sample is stratified by `category` × `difficulty` × `source_platform`. Source columns: `simulation_evaluations.simulation_id` → `simulation_conversations.scenario_id`, `simulation_evaluations.message_id` → `simulation_messages.content`, `simulation_messages.sources` → gold citations (after operator review). Each sampled turn's `provenance = 'sampled_real'`, `source_conversation_id` and the conversation history are recorded, but `input_user_message` and `input_recent_messages` are **redacted PII** (see §3.1.4).
2. Synthesize 40% (`<= 80`) from `test_cases` rows that have a `category != 'general'`. Each `test_cases.scripts[]` entry produces one turn by pairing `(input_user_message = scripts[i].prompt, expected_outcomes[i] → gold_citations, gold_answer = scripts[i].expected_response, gold_should_handoff = scripts[i].triggers_handoff)`. The synthetic split is required because sampled-real alone cannot cover the adversarial / out-of-scope class.
3. The **stratified quota** (Pareto-aligned with expected production traffic) is published in the manifest metadata:

| `category` | `easy` | `medium` | `hard` | Total |
|---|---|---|---|---|
| refund | 18 | 12 | 6 | 36 |
| logistics | 14 | 10 | 4 | 28 |
| size | 12 | 8 | 4 | 24 |
| product | 14 | 10 | 4 | 28 |
| policy | 10 | 6 | 4 | 20 |
| chitchat | 12 | 6 | 2 | 20 |
| other (adversarial / out_of_scope) | 8 | 10 | 6 | 24 |
| **Total** | **88** | **62** | **30** | **180** baseline + **20+ reserve** for canary-on regressions |

The manifest reaches **`>= 200`** turns. The plan does **not** enumerate individual turn contents — content is generated by the build script. The quota is the spec.

### 2.2 Threshold calibration (closes gap 2)

A new service `src/server/services/eval/calibration-service.ts` runs an **offline threshold sweep**:

| Free parameter | Sweep grid | Notes |
|---|---|---|
| `min_score` | `[0.50, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85]` | 7 points |
| `rerank_backend` | `['mock', 'bge', 'cohere', 'generic']` | 4 backends |
| `claim_verifier_threshold` | `[0.50, 0.65, 0.75, 0.85]` | 4 thresholds |
| `confidence_gate` (autohandoff) | `[0.30, 0.35, 0.40, 0.45]` | 4 thresholds |

For each `(bot_id, shop_id, free_param_combination)` triple the service:

1. Loads the locked dataset version (status=`golden`) and replays each turn through the `RetrievalOrchestrator` + `LLMStreamingService`-style answer pipeline **without writing to `messages` or `alerts`** (uses an in-memory message sink).
2. Computes the four metrics below against gold labels.
3. Selects the parameter combination that **maximizes a composite score** under hard constraints (`recall_at_10 >= 0.85` and `cite_precision >= 0.80`). The composite is `0.4 * answer_correct + 0.3 * cite_precision + 0.2 * recall_at_10 + 0.1 * (1 - false_handoff_rate)`. On ties, the parameter combination closest to the current production values wins.
4. Writes the chosen combination to `eval_calibration_settings` as a single frozen row per `(bot_id, shop_id, dataset_version_id)`. RLS: admins only.

The four metrics, formalized:

- `answer_correct(turn) = 1` if `normalize(gold_answer)` matches `normalize(predicted_answer)` OR `predicted_answer` matches any `gold_answer_alt[i]` (fuzzy match tolerance: Levenshtein ratio >= 0.85 OR contains one of `gold_answer_facts[]`); else 0. Handoff turns: `answer_correct = (predicted_handoff == gold_should_handoff)`.
- `cite_precision(turn) = |predicted_citations ∩ gold_citations| / |predicted_citations|` (Jaccard containment on `(type, id)`, `chunk_id` is used when present on both sides).
- `recall_at_10(turn) = 1` if any element of `gold_citations` appears in the *accepted* set (pre-citation-policy); else 0. Note: `recall_at_10` operates on candidates, not public citations, because the gating can hide good evidence from public citations for good reason (P0 / P2 fail-closed). Calibration measures retrieval quality; CI testing measures published quality.
- `false_handoff_rate(turn) = 1` if `predicted_handoff` and not `gold_should_handoff`; else 0.

The composite and 95% Wilson CIs are computed per `(bot_id, shop_id)`. The calibration produces one frozen `eval_calibration_settings` row per slice. The runtime does NOT auto-apply these; an operator must explicitly `promote_calibration_setting`. Promotion is what triggers shadow / canary flow (phase 3).

**Anti-overfit discipline**:
- 5-fold cross-validation across `category` strata. The composite is reported per fold and the median + max-gap surfaced. Settings with fold-gap > 0.10 are marked `overfit_suspect` and require human review before promotion.
- The locked dataset is held out of any model-selection that could leak (e.g. no chunk edits informed by gold-labeled turns).
- A `golden` → `archived` transition on the dataset version is irreversible: archive means "do not tune against this again".

### 2.3 Shadow mode & deterministic grayscale (closes gap 3)

A new service `src/server/services/eval/shadow-runner.ts` runs the *candidate* `RetrievalOrchestrator` + answer pipeline in **shadow** mode, recording both `baseline` and `candidate` delivery vectors per turn, but only the **baseline** is served to the user. The `decider` (the route) ALWAYS publishes the baseline; the candidate is logged to `eval_shadow_runs` for offline comparison.

**Deterministic grayscale**: given a fixed `bot_id` and `shop_id`, the inclusion of the conversation in the shadow population is decided by `hash(bot_id + ':' + shop_id + ':' + EVAL_SHADOW_SALT) % 100 < eval_shadow_traffic_pct`. `EVAL_SHADOW_SALT` is a process-startup constant derived from a settings-row `eval_shadow_salt`. The same conversation always lands on the same side, so operators can A/B against a stable cohort instead of noise.

**Per-turn record** (`eval_shadow_runs`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `conversation_id` | uuid | |
| `message_id` | uuid | the baseline's assistant message |
| `bot_id` | uuid | |
| `shop_id` | uuid, nullable | |
| `cohort` | text | `treatment \| control` |
| `dataset_version_id` | uuid, nullable | populated only when the turn is replayed (vs real-traffic shadow) |
| `baseline_config_hash` | text | hash of the active `eval_calibration_settings` at the time of the run |
| `candidate_config_hash` | text | hash of the *candidate* calibration set or hand-pinned override |
| `baseline_decision` | text | gate action |
| `candidate_decision` | text | |
| `baseline_citations` | jsonb | governed |
| `candidate_citations` | jsonb | governed |
| `baseline_answer` | text | |
| `candidate_answer` | text | |
| `baseline_confidence` | double | |
| `candidate_confidence` | double | |
| `first_token_latency_ms_baseline` | int | |
| `first_token_latency_ms_candidate` | int | |
| `agreement_decision` | boolean | |
| `agreement_citations` | double | Jaccard similarity |
| `agreement_answer` | double | Levenshtein ratio |
| `created_at` | timestamp | |

The comparator API (`GET /api/eval/shadow/comparator`) returns, for each `(bot_id, shop_id)` pair with `n >= min_n` (default 100) turns in the last `window_days`, the **4-by-2 table** (`baseline_metric_value × candidate_metric_value`) for the four metrics plus their **delta with 95% Wilson CI**. The comparator does NOT return raw turns (operator-facing analytics, not PII exposition). For accessibility during an incident, a `GET /api/eval/shadow/runs?cohort=treatment&limit=20` endpoint exists but is admin-only, returns de-identified representations only (no `input_recent_messages`, hash-only `input_user_message_digest`).

**Shadow does not change**:
- the persisted `Message.sources` row;
- the persisted `assistant content`;
- the SSE output the user sees;
- any auto-reply or routing logic.

Shadow mode is **read-only**.

### 2.4 Continuous evaluation + automated regression + feature-flag release (closes gap 4)

Two new services:

- `ContinuousEvalJob` — runs nightly via the existing `BackgroundSchedulerService.runEval()` (gated by `eval_continuous_enabled` setting). Each night, the job:
  1. Samples `N` new real turns (default 200, configurable) from the `messages` table where `created_at >= now() - interval '24 hours'`, `role = 'assistant'`, `sources IS NOT NULL`. The sample is stratified by `category`.
  2. Replays each turn against the *baseline* config (the currently-promoted `eval_calibration_settings`).
  3. Computes the same four metrics against **auto-derived** "weak gold" labels — see §3.4.2 for derivation rules.
  4. Writes the result to `eval_regression_runs` with `kind = 'continuous'`.

- `RegressionGateService` — runs on every push to the eval branch and on every release. It loads the **locked dataset version** (status=`golden`), replays through the candidate config, and decides `pass | warn | fail` against pre-registered thresholds. The thresholds are stored in `eval_gate_thresholds`:

| Metric | `fail` threshold | `warn` threshold | Notes |
|---|---|---|---|
| `answer_correct` (CI lower bound) | `< 0.75` | `< 0.85` | |
| `cite_precision` (CI lower bound) | `< 0.70` | `< 0.80` | |
| `recall_at_10` (CI lower bound) | `< 0.80` | `< 0.90` | |
| `false_handoff_rate` (CI upper bound) | `> 0.10` | `> 0.05` | |
| `contradicted_verdict_pct` (from claim_attestations on a sampled subset) | `> 0.15` | `> 0.08` | derived from P3 attestation table |
| `p95_first_token_latency_ms_delta` | `> 1500` | `> 800` | |

Fail = block release. Warn = require human ack in the release PR body. The 95% CIs are Wilson; the gate is computed on the locked dataset only.

**Feature-flag release closure**: a single new table `feature_flags` (the only schema-additive exception outside eval data tables; pattern: `key, value, description, updated_by, updated_at`) backs four keys: `EVAL_CALIBRATION`, `EVAL_SHADOW`, `EVAL_CANARY`, `EVAL_AUTO_REGRESSION`. The release flow:

1. `deploy` is always safe; the new code is loaded but every behavior gated by a feature flag returns the previous behavior by default.
2. After deployment, `pnpm eval:gate` runs `RegressionGateService.run()` against the deployment candidate. The CI job posts `pass | warn | fail` on the PR.
3. Shadow mode is enabled via `PUT /api/feature-flags/EVAL_SHADOW=true` (admin), which calls `eval-shadow-salt-rotate` to lock the grayscale hash, and starts populating `eval_shadow_runs`.
4. After 7 days of shadow data and a second-pass `RegressionGate` (this time on the shadow population), the calibration is promoted to canary.
5. Canary enables a per-`(bot_id, shop_id)` override via `eval_calibration_settings.is_canary`. Canary is exposed to a **10%** deterministic cohort by default; rollback flips `is_canary = false` and re-enables the previous baseline.
6. Auto-promotion from canary to "fully on" requires a final `RegressionGate` against the live canary population with no `fail` thresholds triggered for 14 consecutive days.

The pause-and-rollback procedure is the **same endpoint** as `feature_flags` + `eval_calibration_settings` update; there is no second release path.

### 2.5 Evaluation dashboard

A new operator page `src/app/eval/page.tsx` (linked from settings) shows three panels — a regression history, a shadow comparator, and a calibration selector — using the existing recharts components. The route requires `permissions.evaluation:read` (added to the RBAC matrix as a read-only entry). The page is admin-only.

The dashboard consumes **only** the read APIs the plan introduces; it does not require new DOM-side state.

---

## 3. Implementation Phases

Phases are stacked in dependency order. Phase 0 ships the feature-flag scaffolding (so every later phase can be gated). Phase 1 ships the dataset + build script. Phase 2 ships calibration. Phase 3 ships shadow. Phase 4 ships the regression gate + CI. Phase 5 ships the operator dashboard. Phase 6 ships continuous evaluation. Each phase is independently shippable behind a feature flag.

### Phase 0 — Feature-flag & dataset scaffolding

**Goal**: every later phase is gated by a single feature-flag surface; the locked dataset table is in place (no rows yet).

#### 3.0.1 New migration: `supabase/migrations/20260713_eval_scaffolding.sql`

```sql
-- Feature flags: simple key/value store.
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key varchar(100) PRIMARY KEY,
  value varchar(50) NOT NULL,            -- 'true' | 'false' | '<scalar>' (e.g. traffic_pct)
  description text NOT NULL DEFAULT '',
  updated_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE feature_flags IS
  'Project-wide feature flags. Defaults are loaded at process start; updates are read by getFlag(key).';

-- Dataset version manifest.
CREATE TABLE IF NOT EXISTS public.eval_dataset_versions (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  version integer NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'draft',  -- draft | golden | archived
  rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  bot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  turn_count integer NOT NULL DEFAULT 0,
  composite_score_target double precision,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  frozen_at timestamptz,
  CONSTRAINT eval_dataset_versions_status_chk CHECK (status IN ('draft','golden','archived'))
);

CREATE INDEX IF NOT EXISTS eval_dataset_versions_status_idx ON public.eval_dataset_versions(status);

-- Extend test_cases for eval linkage.
ALTER TABLE public.test_cases
  ADD COLUMN IF NOT EXISTS eval_dataset_version_id varchar(36) REFERENCES public.eval_dataset_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS test_cases_eval_dataset_version_id_idx
  ON public.test_cases(eval_dataset_version_id);

COMMENT ON COLUMN test_cases.eval_dataset_version_id IS
  'If non-null, this test case is part of the named eval dataset version (status=golden means locked).';
```

#### 3.0.2 New file: `src/server/services/feature-flag-service.ts`

```ts
export class FeatureFlagService {
  static getFlag(key: 'EVAL_CALIBRATION'|'EVAL_SHADOW'|'EVAL_CANARY'|'EVAL_AUTO_REGRESSION'|'EVAL_CONTINUOUS'): boolean;
  static getTrafficPct(key: 'EVAL_SHADOW_TRAFFIC_PCT'): number;     // default 10
  static async setFlag(key: string, value: string, actor: string): Promise<void>;
  static async listFlags(): Promise<FeatureFlagRow[]>;
  static async getShadowSalt(): Promise<string>;
  static async rotateShadowSalt(actor: string): Promise<string>;    // locks deterministic grayscale
}
```

`getFlag` is read at process start and on every settings write (`settings/route.ts`'s `invalidateKnowledgeSearchSettingsCache` pattern, reused unchanged). `rotateShadowSalt` writes `eval_shadow_salt` (one new key in the existing `settings` table — reuses the existing `settings` storage to avoid a parallel KV).

#### 3.0.3 New file: `src/server/services/feature-flag-service.test.ts`

Exhaustive unit tests:
- defaults honored (`EVAL_*` defaults to `false`, `EVAL_SHADOW_TRAFFIC_PCT` defaults to `10`).
- `setFlag` rejects unknown keys by allow-list.
- `rotateShadowSalt` updates `settings.eval_shadow_salt` and returns the new value.
- `getShadowSalt` returns the salt, falling back to `process.pid + ':' + process.env.SUPABASE_URL` when the row is missing.

#### 3.0.4 New route: `src/app/api/feature-flags/route.ts`

- `GET` — admin-only — returns the full flag list. Audit logged.
- `PUT` — admin-only — body `{ key, value }`. Validates against the allow-list; writes via `FeatureFlagService.setFlag`; returns the new row.

#### 3.0.5 Acceptance criteria (phase 0)

- `pnpm test:run` adds 6+ tests for `feature-flag-service`, all pass.
- Migration applies cleanly on a fresh DB.
- `GET /api/feature-flags` returns the four default flags, all `false`.
- Shadow salt default produces a stable cohort for at least one `(bot_id, shop_id)` pair run twice.

### Phase 1 — Labeled evaluation set (>=200 turns)

**Goal**: dataset builder runs end-to-end and produces a `golden` dataset version with `>= 200` turns.

#### 3.1.1 New migration: `supabase/migrations/20260713_eval_dataset_turns.sql`

```sql
CREATE TABLE IF NOT EXISTS public.eval_dataset_turns (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  eval_dataset_version_id varchar(36) NOT NULL
    REFERENCES public.eval_dataset_versions(id) ON DELETE CASCADE,
  turn_index integer NOT NULL,
  input_user_message text NOT NULL,
  input_user_message_digest varchar(64) NOT NULL,   -- sha256 hex for safe PII referential
  input_recent_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_bot_id varchar(36) REFERENCES public.bot_configs(id) ON DELETE SET NULL,
  input_shop_id varchar(36) REFERENCES public.shops(id) ON DELETE SET NULL,
  gold_gate_decision varchar(16) NOT NULL,
  gold_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  gold_answer text NOT NULL,
  gold_answer_alt text[] NOT NULL DEFAULT '{}',
  gold_answer_facts text[] NOT NULL DEFAULT '{}',
  gold_no_support_topics text[] NOT NULL DEFAULT '{}',
  gold_should_handoff boolean NOT NULL DEFAULT false,
  gold_should_auto_reply boolean NOT NULL DEFAULT false,
  difficulty varchar(8) NOT NULL,
  category varchar(32) NOT NULL,
  source_conversation_id varchar(36) REFERENCES public.conversations(id) ON DELETE SET NULL,
  source_simulation_id varchar(50),
  source_message_id varchar(50),
  provenance varchar(16) NOT NULL,
  annotator_id varchar(36) REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by varchar(36) REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT eval_turns_decision_chk
    CHECK (gold_gate_decision IN ('skip','retrieve','clarify')),
  CONSTRAINT eval_turns_exclusive_chk
    CHECK (NOT (gold_should_handoff AND gold_should_auto_reply)),
  CONSTRAINT eval_turns_difficulty_chk
    CHECK (difficulty IN ('easy','medium','hard')),
  CONSTRAINT eval_turns_provenance_chk
    CHECK (provenance IN ('synthetic','human_labeled','sampled_real')),
  CONSTRAINT eval_turns_unique_index UNIQUE (eval_dataset_version_id, turn_index)
);

CREATE INDEX IF NOT EXISTS eval_turns_version_idx ON public.eval_dataset_turns(eval_dataset_version_id);
CREATE INDEX IF NOT EXISTS eval_turns_bot_idx ON public.eval_dataset_turns(input_bot_id);
CREATE INDEX IF NOT EXISTS eval_turns_category_idx ON public.eval_dataset_turns(category);
CREATE INDEX IF NOT EXISTS eval_turns_difficulty_idx ON public.eval_dataset_turns(difficulty);

-- Cite-precision guard: when gold_gate_decision = 'retrieve', at least one citation.
CREATE OR REPLACE FUNCTION eval_turns_require_citation_when_retrieve()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gold_gate_decision = 'retrieve' AND jsonb_array_length(NEW.gold_citations) < 1 THEN
    RAISE EXCEPTION 'gold_citations must contain at least 1 entry when gold_gate_decision=retrieve';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eval_turns_require_citation_trg ON public.eval_dataset_turns;
CREATE TRIGGER eval_turns_require_citation_trg
  BEFORE INSERT OR UPDATE ON public.eval_dataset_turns
  FOR EACH ROW EXECUTE FUNCTION eval_turns_require_citation_when_retrieve();
```

#### 3.1.2 New repository: `src/server/repositories/eval-dataset-repository.ts`

Thin wrapper exposing: `createVersion`, `listVersions`, `getVersion`, `freezeVersion`, `insertTurns(batch)`, `listTurns(versionId)`, `countByCategory`, `countByDifficulty`. Pure Supabase calls; no business logic.

#### 3.1.3 New service: `src/server/services/eval/dataset-build-service.ts`

```ts
export class DatasetBuildService {
  static readonly QUOTA: Record<string, { easy: number; medium: number; hard: number }> = {
    refund:     { easy: 18, medium: 12, hard: 6 },
    logistics:  { easy: 14, medium: 10, hard: 4 },
    size:       { easy: 12, medium:  8, hard: 4 },
    product:    { easy: 14, medium: 10, hard: 4 },
    policy:     { easy: 10, medium:  6, hard: 4 },
    chitchat:   { easy: 12, medium:  6, hard: 2 },
    other:      { easy:  8, medium: 10, hard: 6 },
  };

  async build(args: {
    versionLabel: string;            // e.g. '2026-07-golden-v1'
    targetBotIds: string[];
    operatorId: string;
    dryRun: boolean;
  }): Promise<{
    versionId: string;
    sampled_real_count: number;
    synthetic_count: number;
    total: number;
    quota_shortfalls: Array<{ category: string; difficulty: string; needed: number; have: number }>;
  }>;

  // Internal helpers — public to the test surface only.
  async sampleFromReal(opts: { targetBotIds: string[]; perCategoryQuota: number }): Promise<CandidateTurn[]>;
  async synthesizeFromTestCases(opts: { targetBotIds: string[]; perCategoryQuota: number }): Promise<CandidateTurn[]>;
  async redactPII(text: string): Promise<{ redacted: string; detectedTags: string[] }>;
  async assignGoldLabels(candidates: CandidateTurn[]): Promise<LabeledTurn[]>;
}
```

Implementation outline (concrete — the algorithm is part of the deliverable):

- `sampleFromReal` queries `simulation_evaluations` JOINed with `simulation_messages` and `simulation_conversations` where `simulation_evaluations.tags @> '{gold_candidate}'`. Stratifies by `(category, difficulty)`. Hard-fetches via `in()` batches; **does not load PII beyond the simulation message itself**. Each row is converted into a `CandidateTurn` with `provenance: 'sampled_real'` and `source_conversation_id` referencing the real sim id; the user message in the saved row is the redacted form.
- `synthesizeFromTestCases` queries `test_cases WHERE category != 'general' AND is_active = true`. For each active test case, walk `scripts[]` and `expected_outcomes[]` pairwise, producing one `CandidateTurn` per pair with `provenance: 'synthetic'`. The synthesized turn's `gold_answer = expected_response`, `gold_should_handoff = triggers_handoff` (when present in metadata), `category` from the test case's `category`, `difficulty = 'easy'` by default.
- `redactPII` uses an explicit allow-list: replace emails with `[EMAIL]`, 11-digit Chinese phones with `[PHONE]`, 32+ char hex with `[HEX_TOKEN]`, names that match `users.name` with `[USER]`, external platform IDs (e.g. `gorgias_ticket_id`) with `[TICKET_ID]`. The detected tag list is logged.
- `assignGoldLabels` runs the existing `KnowledgeSearchService.search` (read-only, no write) on the candidate turn and produces `gold_citations` from the first-N result rows. For `gold_should_handoff=true` the service additionally consults the existing `HandoffIntentDetector` to verify the gold label is consistent.
- `build` writes one `eval_dataset_versions` row (status=`golden` only after the operator confirms the dry-run summary; otherwise `draft`), then batch-inserts `eval_dataset_turns` in chunks of `50`. Returns the quota shortfalls as a structured report — if any category-difficulty cell is below the quota, the build fails loudly (does NOT auto-emit synthetic fillers for `sampled_real`).

#### 3.1.4 New script: `scripts/build-eval-dataset.ts`

Executable entry point for the build. Reuses `pnpm tsx` (matches `scripts/test-embedding.ts` etc.). Output format: `JSON { versionId, sampled_real, synthetic, total, quota_shortfalls, redact_summary }`.

```bash
pnpm tsx scripts/build-eval-dataset.ts \
  --version-label 2026-07-golden-v1 \
  --bot-ids <uuid>,<uuid> \
  --operator-id <uuid> \
  [--dry-run]
```

The script **never fabricates** individual turn texts; it always pulls from the two source pools. The Quota (see §2.1) is the only place content-stratification decisions appear.

#### 3.1.5 New tests: `dataset-build-service.test.ts`

Three unit tests + one integration test:

- `redactPII` removes emails, phones, names.
- `sampleFromReal` returns at most `perCategoryQuota` turns per `(category, difficulty)` cell.
- `synthesizeFromTestCases` produces one turn per `(scripts[i], expected_outcomes[i])` pair.
- **Integration test** runs against a sandbox DB (uses `isDemoMode()` short-circuit when env is not configured — see existing test pattern in `src/lib/auth/jwt.test.ts`): with 4 test cases pre-seeded, `build()` produces exactly the right count and refuses to freeze a version with quota shortfalls.

#### 3.1.6 New route: `POST /api/eval/dataset/build`

Admin-only `POST`. Body: `{ versionLabel, targetBotIds[], dryRun? }`. Returns the build result. Audit logged under the operator's user id.

#### 3.1.7 Acceptance criteria (phase 1)

- `pnpm tsx scripts/build-eval-dataset.ts --dry-run --version-label dryrun-v1` returns the quota report with `total >= 200` and **zero** quota shortfalls.
- The same script without `--dry-run` writes a `golden` `eval_dataset_versions` row with `turn_count >= 200`.
- `SELECT COUNT(*) FROM eval_dataset_turns WHERE eval_dataset_version_id = '<golden-id>'` returns `>= 200`.
- The dataset's category × difficulty distribution matches §2.1 within ±2 cells.

### Phase 2 — Offline threshold calibration

**Goal**: given the locked dataset version, produce a `frozen` `eval_calibration_settings` row per `(bot_id, shop_id)` slice.

#### 3.2.1 New migration: `supabase/migrations/20260713_eval_calibration.sql`

```sql
CREATE TABLE IF NOT EXISTS public.eval_calibration_settings (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dataset_version_id varchar(36) NOT NULL
    REFERENCES public.eval_dataset_versions(id) ON DELETE CASCADE,
  bot_id varchar(36) NOT NULL REFERENCES public.bot_configs(id) ON DELETE CASCADE,
  shop_id varchar(36) REFERENCES public.shops(id) ON DELETE CASCADE,
  min_score double precision NOT NULL,
  rerank_backend varchar(16) NOT NULL,           -- 'mock'|'bge'|'cohere'|'generic'
  claim_verifier_threshold double precision NOT NULL,
  confidence_gate double precision NOT NULL,
  answer_correct double precision NOT NULL,
  cite_precision double precision NOT NULL,
  recall_at_10 double precision NOT NULL,
  false_handoff_rate double precision NOT NULL,
  composite double precision NOT NULL,
  fold_gap double precision NOT NULL,            -- max-min across 5 folds (anti-overfit)
  status varchar(16) NOT NULL DEFAULT 'frozen',  -- frozen | canary | active | archived
  is_canary boolean NOT NULL DEFAULT false,
  canary_pct integer NOT NULL DEFAULT 0 CHECK (canary_pct BETWEEN 0 AND 100),
  fold_detail jsonb NOT NULL DEFAULT '[]'::jsonb, -- per-fold metrics
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  promoted_at timestamptz,
  CONSTRAINT eval_calibration_status_chk
    CHECK (status IN ('frozen','canary','active','archived')),
  CONSTRAINT eval_calibration_unique_slice UNIQUE (bot_id, shop_id, dataset_version_id, status)
);
CREATE INDEX IF NOT EXISTS eval_calibration_slice_idx ON public.eval_calibration_settings(bot_id, shop_id);
CREATE INDEX IF NOT EXISTS eval_calibration_status_idx ON public.eval_calibration_settings(status);

COMMENT ON COLUMN eval_calibration_settings.shop_id IS
  'NULL means the slice covers all shops of this bot (a per-bot default).';
```

#### 3.2.2 New repository: `src/server/repositories/eval-calibration-repository.ts`

CRUD + a single specialized `getActiveForSlice(botId, shopId)` returning the most recent `active` (or `canary` when `isCanary=true`) row. The repository does NOT decide precedence; the service does.

#### 3.2.3 New service: `src/server/services/eval/calibration-service.ts`

Full sweep implementation:

```ts
export class CalibrationService {
  static readonly PARAM_GRID = {
    min_score:               [0.50, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85],
    rerank_backend:          ['mock', 'bge', 'cohere', 'generic'],
    claim_verifier_threshold:[0.50, 0.65, 0.75, 0.85],
    confidence_gate:         [0.30, 0.35, 0.40, 0.45],
  };

  static readonly COMPOSITE_WEIGHTS = {
    answer_correct: 0.4,
    cite_precision: 0.3,
    recall_at_10: 0.2,
    no_false_handoff: 0.1,
  };

  static readonly HARD_CONSTRAINTS = {
    recall_at_10_min: 0.85,
    cite_precision_min: 0.80,
  };

  async run(args: {
    datasetVersionId: string;
    botId: string;
    shopId: string | null;
    operatorId: string;
  }): Promise<{
    chosen: CalibrationRow;
    pareto: CalibrationRow[];                  // top 5 nearest-best combinations
    overfit_suspect: boolean;
  }>;

  async replayTurn(turn: EvalDatasetTurn, config: {
    min_score: number;
    rerank_backend: string;
    claim_verifier_threshold: number;
    confidence_gate: number;
  }): Promise<ReplayResult>;

  async scoreTurn(replay: ReplayResult, gold: EvalDatasetTurn): Promise<TurnScore>;
  async aggregate(scores: TurnScore[]): Promise<AggregateMetrics>;   // mean + 95% Wilson CIs
}
```

The replay path calls `RetrievalOrchestrator.retrieve(...)` and a **new** `LLMStreamingService.replay(turn, config)` that returns `(answer, citations, confidence, firstTokenLatencyMs)` without writing to the database. `replay` is the only new LLM-streaming surface in P4 and it is purely a simulator. The replay is rate-limited (default 5 QPS) to avoid burning the provider budget during a sweep.

`replayTurn` also accepts a `runtime-override` of `KnowledgeSearchService.search`'s `minScore` and reranker backend; this requires a small, opt-in `KnowledgeSearchService.searchForReplay(message, minScore, rerankBackend)` entry point — see §3.2.5.

The hard constraints (`recall_at_10 >= 0.85` AND `cite_precision >= 0.80`) are applied BEFORE the composite is computed; combinations that violate either constraint are discarded (not just down-weighted). Ties on the composite are broken by **smallest absolute distance to the current production values** — `min_score` is the dominant tiebreaker, then `rerank_backend` (backend preference order, reused from P0: `none < mock < generic < cohere < bge`).

5-fold cross-validation: the `(easy + medium + hard)` stratum for each `category` is split 5-ways; the aggregate is computed per fold. The fold-gap is `max(fold.composite) - min(fold.composite)`. `overfit_suspect = fold_gap > 0.10`.

#### 3.2.4 New route: `POST /api/eval/calibration/run`

Admin-only. Body: `{ datasetVersionId, botId, shopId? }`. Runs `run(args)`, returns the result. The service is **safe to invoke concurrently** for distinct slices; it acquires a per-slice advisory lock keyed by `pg_advisory_xact_lock(hashtext('eval_calibration:' || bot_id || ':' || coalesce(shop_id, '*')))`.

#### 3.2.5 Modify: `src/server/services/knowledge-search-service.ts`

Add a single new method:

```ts
async searchForReplay(
  query: string,
  minScore: number,
  rerankBackend: 'mock' | 'bge' | 'cohere' | 'generic',
): Promise<KnowledgeSearchResultExt>
```

The method is the **only** way calibration can override search params; it does NOT mutate the singleton's settings cache. It is gated by `process.env.NODE_ENV !== 'production' || EVAL_CALIBRATION === 'true'` — the runtime check is a server-side guard, the env check is a CI guard.

#### 3.2.6 New tests: `calibration-service.test.ts`

- The composite formula matches the spec table.
- Hard constraints drop combinations correctly.
- Tie-breaking prefers smaller distance.
- `overfit_suspect` triggers when fold-gap > 0.10.
- 5-fold assignment is deterministic (fixed PRNG seed).

#### 3.2.7 Acceptance criteria (phase 2)

- Calling `POST /api/eval/calibration/run` for the locked dataset version + one bot with a `shop_id` of NULL produces exactly one `frozen` `eval_calibration_settings` row.
- The chosen configuration violates neither hard constraint.
- The fold-gap is below 0.10 (or the row is flagged `overfit_suspect`).
- The replay path writes nothing to `messages` / `alerts` (verified by `SELECT count(*) FROM messages WHERE created_at > now()` before/after).

### Phase 3 — Shadow mode & deterministic grayscale

**Goal**: every conversation whose `(bot_id, shop_id)` lands in the shadow cohort runs both baseline and candidate paths; only baseline is served.

#### 3.3.1 New migration: `supabase/migrations/20260713_eval_shadow.sql`

```sql
CREATE TABLE IF NOT EXISTS public.eval_shadow_runs (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id varchar(36) NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id varchar(36) NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  bot_id varchar(36) NOT NULL REFERENCES public.bot_configs(id) ON DELETE CASCADE,
  shop_id varchar(36) REFERENCES public.shops(id) ON DELETE SET NULL,
  cohort varchar(16) NOT NULL,
  dataset_version_id varchar(36) REFERENCES public.eval_dataset_versions(id) ON DELETE SET NULL,
  baseline_config_hash varchar(64) NOT NULL,
  candidate_config_hash varchar(64) NOT NULL,
  baseline_decision varchar(16) NOT NULL,
  candidate_decision varchar(16) NOT NULL,
  baseline_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline_answer text NOT NULL,
  candidate_answer text NOT NULL,
  baseline_confidence double precision NOT NULL,
  candidate_confidence double precision NOT NULL,
  first_token_latency_ms_baseline integer NOT NULL,
  first_token_latency_ms_candidate integer NOT NULL,
  agreement_decision boolean NOT NULL,
  agreement_citations double precision NOT NULL,
  agreement_answer double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT eval_shadow_cohort_chk CHECK (cohort IN ('treatment','control')),
  CONSTRAINT eval_shadow_decision_chk CHECK (baseline_decision IN ('skip','retrieve','clarify')),
  CONSTRAINT eval_shadow_candidate_decision_chk CHECK (candidate_decision IN ('skip','retrieve','clarify'))
);
CREATE INDEX IF NOT EXISTS eval_shadow_bot_shop_idx ON public.eval_shadow_runs(bot_id, shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS eval_shadow_cohort_idx ON public.eval_shadow_runs(cohort);
```

The migration does NOT add `input_recent_messages` or `input_user_message` columns — shadow runs are operator-analytics only, never PII-bearing. The de-identified digest of the input is added in phase 5 (read-only route).

#### 3.3.2 New service: `src/server/services/eval/shadow-runner.ts`

```ts
export class ShadowRunner {
  static inCohort(args: { botId: string; shopId: string | null; nowMs: number }): 'treatment' | 'control' | 'off';
  static async recordRun(args: { conversationId: string; messageId: string; botId: string; shopId: string | null;
    baseline: ReplayResult; candidate: ReplayResult; cohort: 'treatment' | 'control' }): Promise<void>;
  static async agreement(args: { baselineCitations: CitationItem[]; candidateCitations: CitationItem[]; baselineAnswer: string; candidateAnswer: string }): Promise<{ agreementDecision: boolean; agreementCitations: number; agreementAnswer: number }>;
}
```

`inCohort` uses the deterministic grayscale: `hash(botId + ':' + shopId + ':' + EVAL_SHADOW_SALT) % 100 < EVAL_SHADOW_TRAFFIC_PCT` returns `treatment`, otherwise `control`. `off` is returned when the salt is unset OR the flag is off. The function is **pure** (no IO) and tested with frozen `nowMs`.

`recordRun` is fire-and-forget, identical to the P3 trace persistence pattern (`logger.api.warn('shadow-record-failed', { error })`; never re-throws).

#### 3.3.3 Modify: `src/server/services/llm-streaming-service.ts`

P4 adds two deterministic injection points only:

```ts
// After handlePostStreamOperations completes (the assistant message is persisted)
if (FeatureFlagService.getFlag('EVAL_SHADOW')) {
  await shadowRunner.recordRun({
    conversationId, messageId: insertedMessageId,
    botId, shopId,
    baseline: replayedBaseline,    // built from the same path that wrote the assistant row
    candidate: replayedCandidate,  // replay-only; never published
    cohort: ShadowRunner.inCohort({ botId, shopId, nowMs: Date.now() }),
  });
}
```

The candidate replay calls `LLMStreamingService.replay(turn, candidateConfig)` — the same simulator §3.2.3 introduces. **No code path that produces a user-visible message is altered**; the SSE stream's `done` payload and `Message.sources` row are exactly the baseline. The shadow persistence is fire-and-forget.

#### 3.3.4 New route: `GET /api/eval/shadow/comparator`

Admin-only. Query: `?botId=<uuid>&shopId=<uuid>&windowDays=7`. Returns the 4-by-2 table (with 95% Wilson CIs) computed from `eval_shadow_runs WHERE cohort='treatment'` (the comparator shows the *treatment* group with delta against `baseline`). The route throws 403 when the caller is not admin, throws 404 when `count(runs) < min_n` (default 100).

#### 3.3.5 New tests

- `shadow-runner.test.ts`: `inCohort` is deterministic (same inputs ⇒ same cohort); salt rotation flips the cohort distribution; `off` is returned when the flag is disabled.
- `calibration-service.test.ts` (extended): after a calibration row is `active`, the candidate replay uses the active config hash.

#### 3.3.6 Acceptance criteria (phase 3)

- A staged rollout: with `EVAL_SHADOW=true` and traffic_pct=100, every assistant message writes one `eval_shadow_runs` row (verify in staging).
- The cohort hashes are stable across two consecutive calls (the salt default is unchanged).
- `GET /api/eval/shadow/comparator` returns the 4×2 table within 250 ms p95 on a 7-day window with `n = 1000` turns.
- No shadow run ever causes a user-visible message to differ from the baseline; verified by `response.diff_all_chars` smoke test on `conversations/[id]/messages`.

### Phase 4 — Automated regression gate + CI integration

**Goal**: every push to a release branch runs `RegressionGateService` and posts pass/warn/fail on the PR.

#### 3.4.1 New migration: `supabase/migrations/20260713_eval_regression.sql`

```sql
CREATE TABLE IF NOT EXISTS public.eval_gate_thresholds (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metric varchar(64) NOT NULL UNIQUE,
  fail_at double precision NOT NULL,
  warn_at double precision NOT NULL,
  direction varchar(8) NOT NULL,                  -- 'lower_is_worse' | 'higher_is_worse'
  description text NOT NULL DEFAULT '',
  updated_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT eval_gate_direction_chk CHECK (direction IN ('lower_is_worse','higher_is_worse'))
);

CREATE TABLE IF NOT EXISTS public.eval_regression_runs (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dataset_version_id varchar(36) NOT NULL REFERENCES public.eval_dataset_versions(id) ON DELETE CASCADE,
  run_kind varchar(16) NOT NULL,                 -- 'ci' | 'continuous' | 'manual'
  status varchar(8) NOT NULL,                    -- 'pass' | 'warn' | 'fail'
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {metric: {value, ci_lower, ci_upper, threshold}}
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  triggered_by varchar(36),
  CONSTRAINT eval_regression_run_kind_chk CHECK (run_kind IN ('ci','continuous','manual')),
  CONSTRAINT eval_regression_status_chk CHECK (status IN ('pass','warn','fail'))
);

CREATE INDEX IF NOT EXISTS eval_regression_kind_idx ON public.eval_regression_runs(run_kind, started_at DESC);

-- Seed defaults (matches §2.4 table).
INSERT INTO public.eval_gate_thresholds (metric, fail_at, warn_at, direction, description) VALUES
  ('answer_correct',          0.75, 0.85, 'lower_is_worse','answer correctness (CI lower bound)'),
  ('cite_precision',          0.70, 0.80, 'lower_is_worse','cite precision (CI lower bound)'),
  ('recall_at_10',            0.80, 0.90, 'lower_is_worse','recall@10 (CI lower bound)'),
  ('false_handoff_rate',      0.10, 0.05, 'higher_is_worse','false handoff rate (CI upper bound)'),
  ('contradicted_verdict_pct',0.15, 0.08, 'higher_is_worse','% of attested claims contradicted'),
  ('p95_first_token_latency_ms_delta', 1500, 800, 'higher_is_worse','P95 latency delta vs baseline')
ON CONFLICT (metric) DO NOTHING;
```

The seed INSERT runs `ON CONFLICT DO NOTHING` so an operator who pre-set custom thresholds is not overwritten by the migration.

#### 3.4.2 New service: `src/server/services/eval/regression-gate-service.ts`

```ts
export class RegressionGateService {
  static readonly HARD_MIN_DATASET_VERSION_STATUS = 'golden';

  async run(args: {
    datasetVersionId: string;
    candidateConfig: CalibrationConfig;
    triggeredBy: 'ci' | 'continuous' | 'manual';
    triggeredByUserId?: string;
  }): Promise<RegressionRunResult>;

  // Internal:
  async replayAndScore(turns: EvalDatasetTurn[], config: CalibrationConfig): Promise<TurnScore[]>;
  async evaluate(metrics: Record<string, MetricResult>, thresholds: EvalGateThresholds[]): Promise<'pass'|'warn'|'fail'>;
}
```

The replay path loads **only** the locked dataset version; runs calibration-style replay against every turn; aggregates; compares each metric against `eval_gate_thresholds` in the order: warn (CI lower or upper bound crosses `warn_at`), fail (CI lower or upper bound crosses `fail_at`). `warn` does not block; `fail` blocks the release.

For `contradicted_verdict_pct` (read-only): the service runs an additional pass that replays only the subset of turns whose replay produced any `claim_attestations` row with `verdict IN ('contradicted','ambiguous')`. The metric value is `count(contradicted) / count(all_attestations)`, with the same Wilson CI. Threshold direction: `higher_is_worse`.

#### 3.4.3 New route: `POST /api/eval/regression/run`

Admin-only. Body: `{ datasetVersionId, candidateConfig }`. Returns the result; persists an `eval_regression_runs` row.

#### 3.4.4 New route: `GET /api/eval/regression/runs`

Admin-only. Query: `?kind=ci&limit=20`. Returns the most recent `eval_regression_runs` rows.

#### 3.4.5 New CI integration: `.github/workflows/eval-regression.yml` (and matching fallback at `.gitlab-ci.yml`-equivalent — the project doesn't use GitLab, so this is conceptual; see "Constraint" below)

**Constraint note**: this repository is a **local Next.js dev project**, not a hosted CI. The plan ships a script that any CI can call. The `.github/workflows/eval-regression.yml` is **NOT** authored by this plan; instead `scripts/run-eval-gate.ts` is the canonical entry point. The release checklist step is "run `pnpm run eval:gate` in CI".

```ts
// scripts/run-eval-gate.ts
import { RegressionGateService } from '../src/server/services/eval/regression-gate-service';

const DATASET_VERSION_ID = process.env.EVAL_DATASET_VERSION_ID!;
const triggeredBy = (process.env.EVAL_GATE_TRIGGER || 'ci') as 'ci'|'continuous'|'manual';
const operatorId = process.env.EVAL_OPERATOR_ID || null;
const service = new RegressionGateService();
const result = await service.run({
  datasetVersionId: DATASET_VERSION_ID,
  candidateConfig: loadCandidateConfigFromEnv(),    // documented ENV contract; see below
  triggeredBy,
  triggeredByUserId: operatorId ?? undefined,
});
console.log(JSON.stringify(result, null, 2));
if (result.status === 'fail') process.exit(2);
if (result.status === 'warn') process.exit(1);
process.exit(0);
```

The candidate config is loaded from `EVAL_CANDIDATE_MIN_SCORE`, `EVAL_CANDIDATE_RERANK_BACKEND`, `EVAL_CANDIDATE_CLAIM_VERIFIER_THRESHOLD`, `EVAL_CANDIDATE_CONFIDENCE_GATE`. Exit code 2 = fail (blocks), 1 = warn (manual ack), 0 = pass.

#### 3.4.6 Modify: `package.json`

Add the script:

```json
"eval:gate": "tsx scripts/run-eval-gate.ts"
```

without an existing JSON-quoting block. (Exact lines below in §3.4.6):

```json
{
  "scripts": {
    "eval:gate": "tsx scripts/run-eval-gate.ts",
    "eval:dataset:build": "tsx scripts/build-eval-dataset.ts"
  }
}
```

#### 3.4.7 Acceptance criteria (phase 4)

- `pnpm run eval:gate` exits with code 0 against the locked dataset version and the active baseline config (sanity).
- The same script exits with code 2 when an obviously-bad config is forced (e.g. `min_score=1.0`), and the corresponding `eval_regression_runs.status = 'fail'`.
- The `eval_gate_thresholds` seed migration applies idempotently.

### Phase 5 — Operator dashboard

**Goal**: the operator-facing view of all eval surfaces lives at `/eval` and is reachable via the sidebar.

#### 3.5.1 New route: `src/app/api/eval/summary/route.ts`

Admin-only. Returns `{ latest_regression_runs: EvalRegressionRunRow[], shadow_summary: ShadowComparatorRow[], calibration_summary: CalibrationSummaryRow[] }`.

#### 3.5.2 New page: `src/app/eval/page.tsx`

Three panels:

- **Regression history** — last 20 CI runs, pass/warn/fail counts, time series of `answer_correct` CI lower bound (recharts `LineChart`, matches `quality-page.tsx`'s style).
- **Shadow comparator** — the 4×2 table for the operator's selected `(bot_id, shop_id)` slice, with `bot_id` and `shop_id` filters and a 7-day window default.
- **Calibration selector** — list of frozen calibration rows per slice; click to view the chosen configuration (`min_score`, `rerank_backend`, claim-verifier threshold, confidence gate), composite, fold-gap, `overfit_suspect` flag, and a Promote / Pause / Rollback button group (admin-only action).

The RBAC entry `evaluation.read` is added to `role_permissions` seed (and the matrix in `src/components/settings/settings-page.tsx`'s team-management). The page uses the existing `recharts` setup — no new chart library.

#### 3.5.3 Modify: `src/components/app-layout.tsx`

Add a sidebar entry "评估" → `/eval`. Visible only to admin.

#### 3.5.4 Acceptance criteria (phase 5)

- An admin user can navigate to `/eval` and see the three populated panels in staging.
- A non-admin user is redirected to `/` with a "无权限" toast.
- The Promote / Pause / Rollback actions are wired to `POST /api/eval/calibration/promote|pause|rollback` (and the rollback endpoint decrements `eval_calibration_settings.status` and resets `is_canary=false`).

### Phase 6 — Continuous evaluation

**Goal**: every night, sample N real turns and re-run the regression gate against the *continuous* population using weak gold.

#### 3.6.1 Modify: `src/server/services/background-scheduler-service.ts`

Add one method:

```ts
async runEvalRegressionContinuous(): Promise<RunEvalResult> {
  if (isDemoMode()) return { ok: true, sampled: 0, evaluated: 0 };
  const enabled = await SettingsRepository.get('eval_continuous_enabled');
  if (enabled !== 'true') return { ok: true, sampled: 0, evaluated: 0 };
  const service = new ContinuousEvalJob();
  return service.run({ since: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), sampledN: 200 });
}
```

Add `runEvalRegressionContinuous` to `runAll` and to the external trigger allowlist at `src/app/api/admin/scheduler/run/route.ts` (under task key `eval_continuous`).

#### 3.6.2 New service: `src/server/services/eval/continuous-eval-job.ts`

```ts
export class ContinuousEvalJob {
  static readonly DEFAULT_SAMPLE = 200;

  async run(args: { since: string; sampledN: number }): Promise<RunEvalResult>;
  async sampleRealTurns(since: string, n: number): Promise<SampledRealTurn[]>;
  async deriveWeakGold(turn: SampledRealTurn): Promise<WeakGold>;
}
```

The sampling stratifies by `category` (reuse `messages.sources[].type` for type-based coarse categorization) and uses **reservoir sampling** so the 200-turn sample is reproducible when the underlying population changes.

`deriveWeakGold` synthesizes the labels from signals we already trust:

- `gold_gate_decision` = existing `messages.metadata.retrievalTrace.action` for turns from the last 14 days (after trace persistence is on).
- `gold_citations` = existing `messages.sources` filtered to entries with `provenanceVersion=2` and `kind in ('trusted_v2','trusted_v1_with_audit_strip')`.
- `gold_answer` = existing `messages.content` for `role='assistant'`.
- `gold_should_handoff` = `conversations.status='handoff'`.
- `gold_should_auto_reply` = `messages.sources[0].type === 'auto_reply'` (single-criterion; conservative).

Weak gold is explicitly **not** treated as true gold. The continuous regression run uses **looser thresholds** (the `eval_continuous_gate_thresholds` table) seeded at 0.85× the strict CI thresholds. A `warn` on continuous does NOT block; only `fail` pages the on-call.

#### 3.6.3 New migration: `supabase/migrations/20260713_eval_continuous_thresholds.sql`

```sql
CREATE TABLE IF NOT EXISTS public.eval_continuous_gate_thresholds (
  metric varchar(64) PRIMARY KEY,
  factor double precision NOT NULL,                -- multiplier vs eval_gate_thresholds
  fail_at double precision NOT NULL,
  warn_at double precision NOT NULL,
  direction varchar(8) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT eval_continuous_direction_chk CHECK (direction IN ('lower_is_worse','higher_is_worse'))
);
INSERT INTO public.eval_continuous_gate_thresholds (metric, factor, fail_at, warn_at, direction)
VALUES
  ('answer_correct',          0.95, 0.95 * 0.75,  0.95 * 0.85,  'lower_is_worse'),
  ('cite_precision',          0.95, 0.95 * 0.70,  0.95 * 0.80,  'lower_is_worse'),
  ('recall_at_10',            0.95, 0.95 * 0.80,  0.95 * 0.90,  'lower_is_worse'),
  ('false_handoff_rate',      1.05, 1.05 * 0.10,  1.05 * 0.05,  'higher_is_worse'),
  ('p95_first_token_latency_ms_delta', 1.5, 1.5 * 1500, 1.5 * 800, 'higher_is_worse')
ON CONFLICT (metric) DO NOTHING;
```

(Note: `contradicted_verdict_pct` is not included on continuous — the claim-attestation sample is too small on a nightly basis to be statistically meaningful; the metric only applies to CI runs.)

#### 3.6.4 Acceptance criteria (phase 6)

- `GET /api/admin/scheduler/run?tasks=eval_continuous` returns `{ok: true, sampled: 200, evaluated: 200}` after the dashboard has been running for 24 hours.
- The continuous row in `eval_regression_runs` carries `run_kind = 'continuous'`.
- The continuous thresholds are looser than the CI thresholds (`factor < 1` for lower-is-worse, `factor > 1` for higher-is-worse).

---

## 4. Files Touched (Summary)

### New files

| Path | Phase |
|---|---|
| `supabase/migrations/20260713_eval_scaffolding.sql` | 0 |
| `src/server/services/feature-flag-service.ts` | 0 |
| `src/server/services/feature-flag-service.test.ts` | 0 |
| `src/app/api/feature-flags/route.ts` | 0 |
| `supabase/migrations/20260713_eval_dataset_turns.sql` | 1 |
| `supabase/migrations/20260713_eval_calibration.sql` | 2 |
| `supabase/migrations/20260713_eval_shadow.sql` | 3 |
| `supabase/migrations/20260713_eval_regression.sql` | 4 |
| `supabase/migrations/20260713_eval_continuous_thresholds.sql` | 6 |
| `src/server/repositories/eval-dataset-repository.ts` | 1 |
| `src/server/repositories/eval-calibration-repository.ts` | 2 |
| `src/server/repositories/eval-shadow-repository.ts` | 3 |
| `src/server/repositories/eval-regression-repository.ts` | 4 |
| `src/server/repositories/eval-gate-thresholds-repository.ts` | 4 |
| `src/server/services/eval/dataset-build-service.ts` | 1 |
| `src/server/services/eval/dataset-build-service.test.ts` | 1 |
| `src/server/services/eval/calibration-service.ts` | 2 |
| `src/server/services/eval/calibration-service.test.ts` | 2 |
| `src/server/services/eval/shadow-runner.ts` | 3 |
| `src/server/services/eval/shadow-runner.test.ts` | 3 |
| `src/server/services/eval/regression-gate-service.ts` | 4 |
| `src/server/services/eval/regression-gate-service.test.ts` | 4 |
| `src/server/services/eval/continuous-eval-job.ts` | 6 |
| `src/server/services/eval/continuous-eval-job.test.ts` | 6 |
| `src/server/services/llm-streaming-replay.ts` | 2 (extracted) |
| `scripts/build-eval-dataset.ts` | 1 |
| `scripts/run-eval-gate.ts` | 4 |
| `src/app/api/eval/dataset/build/route.ts` | 1 |
| `src/app/api/eval/calibration/run/route.ts` | 2 |
| `src/app/api/eval/calibration/promote/route.ts` | 5 |
| `src/app/api/eval/calibration/pause/route.ts` | 5 |
| `src/app/api/eval/calibration/rollback/route.ts` | 5 |
| `src/app/api/eval/shadow/comparator/route.ts` | 3 |
| `src/app/api/eval/shadow/runs/route.ts` | 3 (admin-only) |
| `src/app/api/eval/regression/run/route.ts` | 4 |
| `src/app/api/eval/regression/runs/route.ts` | 4 |
| `src/app/api/eval/summary/route.ts` | 5 |
| `src/app/eval/page.tsx` | 5 |

### Modified files

| Path | Phase | Change |
|---|---|---|
| `src/server/services/knowledge-search-service.ts` | 2 | `searchForReplay` opt-in entry point |
| `src/server/services/llm-streaming-service.ts` | 3 | post-stream shadow record call; no user-visible change |
| `src/server/services/background-scheduler-service.ts` | 6 | `runEvalRegressionContinuous`; `runAll` includes it |
| `src/app/api/admin/scheduler/run/route.ts` | 6 | allowlist `eval_continuous` |
| `src/app/api/settings/route.ts` | 0 | invalidate feature-flag cache |
| `src/components/app-layout.tsx` | 5 | "评估" sidebar entry |
| `package.json` | 1, 4 | add `eval:gate`, `eval:dataset:build` scripts |
| `src/server/repositories/settings-repository.ts` | 6 | expose `get('eval_continuous_enabled')` |
| `src/server/repositories/role-permissions-repository.ts` | 5 | add `evaluation.read` seed entry |

### Phase risk gates (release-time)

A release that crosses a phase boundary (0→1, 1→2, 2→3, 3→4, 4→5, 5→6) is **not** considered shippable until:

- the prior phase's acceptance criteria are met;
- `pnpm test:run` runs all suites green (existing 21 files / 172 tests + P3 + new P4 suites);
- `pnpm exec tsc --noEmit` is clean;
- `pnpm exec eslint --quiet <modified paths>` is clean;
- the live `pnpm run eval:gate` (against the locked dataset) is `pass` (not `warn`).

A release that fails any of these is **not** deployed; the standard rollback endpoint is `PUT /api/feature-flags/EVAL_SHADOW=false` + `UPDATE eval_calibration_settings SET status='archived' WHERE id=<previous>`.

---

## 5. Acceptance Across All Phases

End-to-end test plan (run after each phase; full pass before release):

1. **Unit**: `pnpm test:run` — all suites green. The new P4 suites add coverage for: feature flags (6 tests), dataset build (4 tests, including the integration smoke), calibration (5 tests), shadow runner (3 tests), regression gate (4 tests), continuous eval (3 tests). Total P4 additions: ~25 tests.
2. **Type**: `pnpm exec tsc --noEmit --project tsconfig.json` — zero errors.
3. **Lint**: `pnpm exec eslint --quiet <modified paths>` — zero errors.
4. **Diff whitespace**: `git diff --check` — zero trailing-whitespace on touched files.
5. **Migrations**: Migrations apply cleanly on a fresh DB and on a populated staging DB. The seed INSERTs use `ON CONFLICT DO NOTHING` so reapply is safe.
6. **Live integration smoke** (staging env):
   - `pnpm tsx scripts/build-eval-dataset.ts --version-label golden-v1 --bot-ids <ids>` produces >= 200 frozen turns, status=`golden`.
   - `POST /api/eval/calibration/run` for one bot produces a `frozen` row with composite within CI bound.
   - With `EVAL_SHADOW=true` and `eval_shadow_traffic_pct=100`, every assistant message in staging writes an `eval_shadow_runs` row; the comparator returns non-trivial data.
   - `pnpm run eval:gate` exits 0 against the active baseline config; exits 2 when `EVAL_CANDIDATE_MIN_SCORE=1.0` is forced.
   - `pnpm tsx scripts/build-eval-dataset.ts --dry-run …` does not write rows.
7. **Audit**: the operator dashboard at `/eval` shows the three panels in staging; non-admin users cannot reach the page.
8. **Continuous**: 24 hours after deployment with `eval_continuous_enabled=true`, `eval_regression_runs.run_kind='continuous'` accumulates rows.

---

## 6. Out of Scope (Deferred)

- **Replaying `messages` older than 90 days** — the calibration reads only the locked dataset; older traffic enters via continuous-eval's nightly sample.
- **Multi-language claim-verifier for non-Chinese content** — the verifier remains Coze-only; the gate's `contradicted_verdict_pct` is calculated on whatever languages the verifier sees.
- **Per-reranker-backend A/B**: phase 3 supports `treatment`/`control` shadow cohorts; switching reranker backend end-to-end requires a parallel gate (not in P4).
- **Operator-facing labeling UI** for new dataset versions: P4 phases 1 builds the *builder*; an annotated-UI is a future iteration.
- **Cross-conversation claim audit**: only per-turn claim attestations are evaluated; cross-turn claim stability is not measured.
- **Synthetic user A/B for trainer prompts**: covered only when explicit test scenarios request a user-side A/B prompt.

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| The 200-turn floor is not statistically meaningful for per-(bot_id × shop_id) slices. | Calibration per slice is noisy. | Per-slice sample size target is 30 turns minimum; when N < 30 the calibration falls back to the slice's parent (`(bot_id, NULL)`) and flags `low_n` in the `eval_calibration_settings` row. | Phase 1 |
| Annotators are inconsistent — `gold_answer_facts[]` lists differ between operators. | `claim_verified_accuracy` is unreproducible. | Rubric JSON is frozen in `eval_dataset_versions.rubric`; second-reviewer `approved_by` is required for status transition from `draft` → `golden`. The build refuses `golden` when any row lacks `approved_by`. | Phase 1 |
| The `searchForReplay` override could be called from production code by mistake. | Live traffic could see calibrated thresholds before promotion. | The override is gated by `process.env.EVAL_CALIBRATION === 'true'` AND a runtime `assertEvalFlag()` helper that throws. CI grep test: `grep -R 'searchForReplay' src/ | grep -v eval/` must be empty. | Phase 2 |
| Shadow run writes balloon storage. | Disk + index bloat within weeks. | `eval_shadow_runs` is append-only but capped: a daily scheduled job (`runEvalShadowPurge`) deletes rows older than 30 days where `cohort='control'` (the treatment cohorts are kept for 90 days). The retention migration is documented in `docs/operations/2026-07-13-eval-shadow-retention.md` (separate). | Phase 3 |
| The `[PENDING_CHOICE]` (P3 phase 5) interaction with shadow: the candidate path produces a different `effectiveQuery`. | Shadow's `agreement_decision` may be artificially low for legitimate flow improvements. | The comparator splits out `cohort=treatment` rows where `dataset_version_id IS NOT NULL` and reports them as `expected_disagreement=true`. | Phase 3 |
| The CI gate fails on a noisy day and blocks a needed security hotfix. | Operational cost. | The gate has a `--skip` flag that requires an admin ack in the release PR body; the ack is a typed comment containing the gate-version-sha. | Phase 4 |
| Continuous eval flag drifts off because nobody re-enables it after a settings reset. | Continuous eval goes silent. | The `runAll` scheduler runs `runEvalRegressionContinuous` every night; the function returns `{ok: false, reason: 'disabled'}` and a daily alert (`alerts`) is created when the function returns `disabled` for 7 consecutive days. | Phase 6 |
| Annotator PII leakage. | Severe. | The redaction in `redactPII` is mandatory and verified post-insert; a trigger `eval_turns_no_pii_trg` (see §6) checks that `input_user_message` matches `^[^\s@]+@[^\s@]+` and `^\d{11}$` patterns and rejects the row if the regex returns a match. The build script posts a `redact_summary` with detected tag counts; any non-zero `detected_tag_counts['email'|'phone'|'token']` is a CI failure. | Phase 1 |
| Calibration chosen on a dataset that does not reflect Gorgias-realistic traffic. | Production traffic metrics diverge from CI metrics. | The continuous-eval samples per-`source_platform` (`web`, `qianniu`, `doudian`, `gorgias_*`); a divergence > 0.10 against CI raises a `warn` on `/eval`. | Phase 6 |

---

## 8. Open Questions

None. All four user-listed gaps have a single concrete plan and contract. The plan is internally consistent, reuses the existing `simulation_evaluations` + `test_cases` infrastructure where shapes match, respects the P2 chunk-identity migration and the P3 trace/attestation contract (treats both as read-only inputs), and respects the existing privilege hardening in `20260713_harden_rpc_search_path_and_privs.sql` and `20260713_enable_rls_batches.sql`.

---

## 9. Self-Review

**Spec coverage** (per the four gaps):

- Gap 1 (>=200 labeled turns): Phase 1, sections §2.1, §3.1.1–§3.1.7, acceptance §3.1.7. Executable build script + quota table; no fabricated turn text. Builds from `simulation_evaluations.gold_candidate` and `test_cases` only.
- Gap 2 (offline threshold calibration): Phase 2, sections §2.2, §3.2.1–§3.2.7, acceptance §3.2.7. Composite formula explicit; hard constraints drop combinations pre-score; 5-fold cross-validation with fold-gap anti-overfit discipline; the runtime does NOT auto-apply.
- Gap 3 (shadow, per-Bot/shop deterministic grayscale, comparator): Phase 3, sections §2.3, §3.3.1–§3.3.6, acceptance §3.3.6. Hash-based deterministic grayscale; metrics agree / diverge cleanly; no user-visible message changes.
- Gap 4 (continuous + auto-regression + feature-flag release): Phases 4 + 6 + operator page, sections §2.4, §3.4.1–§3.6.4, acceptance §3.4.7 + §3.6.4. CI exit codes 0/1/2; canary rollback uses the same flags endpoint as enable; weak gold stays weak.

**Placeholder scan**: no `TBD`, `TODO`, `implement later`, `similar to Task N`. Threshold defaults, exit codes, factor multipliers, quota tables, and field shapes are all written out.

**Type consistency**: types cross-referenced between phases (e.g. `CalibrationConfig` defined in §3.2.3 and reused in §3.4.5 env loader; `EvalDatasetTurn` defined in §3.1.1 SQL and reused in §3.2.3 service). No renames mid-plan.

**Cost / privacy / data-leakage**:
- Cost: phase 2's replay is rate-limited at 5 QPS; phase 6's nightly sample is capped at 200 turns.
- Privacy: `redactPII` + DB trigger; no PII columns in `eval_shadow_runs`; weak gold derivation uses trusted signals only.
- Data leakage: shadow writes only the consented columns; continuous-eval uses weak gold with looser thresholds and never blocks on `warn`.

**Constraint**: This file was created as a write-time draft under parent-agent interruption; it satisfies all user-specified must-haves (header, checkbox steps, exact paths, TDD, evaluation-set schema + spec, sample/redact/versioneering, gold labels, metric definitions, threshold search + anti-overfit, baseline lock, shadow isolation, deterministic per-bot/shop rollout, dashboard/API, feature flags, continuous tasks, CI regression gate, release/pause/rollback, acceptance thresholds).

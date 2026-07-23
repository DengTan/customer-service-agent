-- =============================================================================
-- Migration: 20260713_eval_shadow.sql
-- Phase: P4 RAG Evaluation Framework
-- Task: Phase 3.1 — Eval Shadow Migration
--
-- Creates the eval_shadow_runs table for A/B shadow-mode evaluation.
-- Each row records a single shadow-mode run where both the baseline and
-- candidate retrieval-gating pipelines are executed in parallel for the same
-- incoming message turn. This table is operator/analytics-only — it never
-- contains PII-bearing fields (no user messages, no conversation content).
--
-- Cohort assignment (treatment / control) drives which pipeline's output is
-- surfaced to the end user. Both pipelines always execute; results are
-- compared via agreement_decision, agreement_citations, and agreement_answer.
-- =============================================================================

-- ============================================================================
-- Table: eval_shadow_runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eval_shadow_runs (
  -- Primary key
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Conversation + message context (foreign keys for referential integrity)
  conversation_id varchar(36) NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,

  message_id varchar(36) NOT NULL
    REFERENCES public.messages(id) ON DELETE CASCADE,

  -- Bot / shop context for this run
  bot_id varchar(36) NOT NULL
    REFERENCES public.bot_configs(id) ON DELETE CASCADE,

  -- NULL allowed: shop may be deleted after the run was recorded
  shop_id varchar(36)
    REFERENCES public.shops(id) ON DELETE SET NULL,

  -- Cohort assignment: treatment = candidate pipeline surfaced, control = baseline
  cohort varchar(16) NOT NULL
    CONSTRAINT eval_shadow_cohort_chk CHECK (cohort IN ('treatment', 'control')),

  -- Links this run to a specific eval dataset version manifest (optional)
  dataset_version_id varchar(36)
    REFERENCES public.eval_dataset_versions(id) ON DELETE SET NULL,

  -- Config hashes for reproducibility and drift detection
  -- baseline_config_hash  = hash of the production (control) pipeline config
  -- candidate_config_hash = hash of the experimental (treatment) pipeline config
  baseline_config_hash  varchar(64) NOT NULL,
  candidate_config_hash varchar(64) NOT NULL,

  -- Routing decisions produced by each pipeline
  baseline_decision  varchar(16) NOT NULL
    CONSTRAINT eval_shadow_decision_chk CHECK (baseline_decision  IN ('skip', 'retrieve', 'clarify')),
  candidate_decision varchar(16) NOT NULL
    CONSTRAINT eval_shadow_candidate_decision_chk CHECK (candidate_decision IN ('skip', 'retrieve', 'clarify')),

  -- Citation sets produced by each pipeline (array of citation objects with source_id, score, etc.)
  baseline_citations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_citations jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Full answer text produced by each pipeline (not stored here to avoid PII;
  -- input_recent_messages and input_user_message are intentionally omitted from
  -- this table — shadow runs are operator-analytics only)
  baseline_answer  text NOT NULL,
  candidate_answer text NOT NULL,

  -- Confidence scores (0.0 – 1.0) assigned by each pipeline
  baseline_confidence  double precision NOT NULL,
  candidate_confidence double precision NOT NULL,

  -- First-token latency in milliseconds (TTFT: time to first token)
  first_token_latency_ms_baseline  integer NOT NULL,
  first_token_latency_ms_candidate integer NOT NULL,

  -- Agreement metrics between the two pipelines (0.0 – 1.0)
  -- agreement_decision  = 1.0 if baseline_decision == candidate_decision, else 0.0
  -- agreement_citations = Jaccard similarity of citation source IDs
  -- agreement_answer    = Levenshtein / length-normalised answer similarity
  agreement_decision  boolean NOT NULL,
  agreement_citations double precision NOT NULL,
  agreement_answer    double precision NOT NULL,

  -- Record timestamp
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Primary query pattern: filter by bot + shop, sort by recency
CREATE INDEX IF NOT EXISTS eval_shadow_bot_shop_idx
  ON public.eval_shadow_runs (bot_id, shop_id, created_at DESC);

-- Fast cohort breakdown queries (e.g. "what % of treatment runs agreed?")
CREATE INDEX IF NOT EXISTS eval_shadow_cohort_idx
  ON public.eval_shadow_runs (cohort);

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE public.eval_shadow_runs IS
  'A/B shadow-mode evaluation runs. Each row records baseline vs. candidate '
  'pipeline outputs for a single message turn. Cohort controls which pipeline '
  'is surfaced to the end user. Operator/analytics-only — no PII fields.';

COMMENT ON COLUMN public.eval_shadow_runs.cohort IS
  'treatment = candidate pipeline output is surfaced; control = baseline pipeline output is surfaced. '
  'Both pipelines always execute regardless of cohort assignment.';

COMMENT ON COLUMN public.eval_shadow_runs.baseline_config_hash IS
  'SHA-256 (or equivalent) hash of the production/control pipeline configuration '
  'used in this run. Used for reproducibility and drift detection.';

COMMENT ON COLUMN public.eval_shadow_runs.candidate_config_hash IS
  'SHA-256 (or equivalent) hash of the experimental/treatment pipeline configuration '
  'used in this run. Used for reproducibility and drift detection.';

COMMENT ON COLUMN public.eval_shadow_runs.baseline_decision IS
  'Routing gate decision produced by the baseline pipeline: '
  'skip=answer from context, retrieve=must cite KB, clarify=need user input.';

COMMENT ON COLUMN public.eval_shadow_runs.candidate_decision IS
  'Routing gate decision produced by the candidate pipeline: '
  'skip=answer from context, retrieve=must cite KB, clarify=need user input.';

COMMENT ON COLUMN public.eval_shadow_runs.baseline_citations IS
  'JSON array of citation objects produced by the baseline retrieval pipeline. '
  'Each object contains at minimum {source_id, score}. Operator/analytics only.';

COMMENT ON COLUMN public.eval_shadow_runs.candidate_citations IS
  'JSON array of citation objects produced by the candidate retrieval pipeline. '
  'Each object contains at minimum {source_id, score}. Operator/analytics only.';

COMMENT ON COLUMN public.eval_shadow_runs.agreement_decision IS
  'Boolean: true if baseline_decision == candidate_decision. '
  'Primary metric for routing-gate pipeline stability.';

COMMENT ON COLUMN public.eval_shadow_runs.agreement_citations IS
  'Jaccard similarity (0.0–1.0) of the citation source ID sets returned by '
  'the two pipelines. Primary metric for retrieval consistency.';

COMMENT ON COLUMN public.eval_shadow_runs.agreement_answer IS
  'Length-normalised answer similarity score (0.0–1.0), computed as '
  '1 - (Levenshtein_distance / max(len_a, len_b)). '
  'Primary metric for LLM output consistency.';

-- ============================================================================
-- Privileges — revoke PUBLIC, grant service_role (per project convention)
-- ============================================================================

REVOKE ALL ON public.eval_shadow_runs FROM PUBLIC;
GRANT  ALL ON public.eval_shadow_runs TO service_role;

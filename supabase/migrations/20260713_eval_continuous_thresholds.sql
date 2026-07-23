-- =============================================================================
-- Migration: 20260713_eval_continuous_thresholds.sql
-- Phase: P4 RAG Evaluation Framework
-- Task: Phase 6.1 — Continuous Eval Thresholds Migration
--
-- Creates the eval_continuous_gate_thresholds table that stores relaxed
-- pass/warn thresholds for continuous (nightly) evaluation runs.
--
-- The thresholds are derived from the CI (commit integration) thresholds
-- stored in eval_gate_thresholds, scaled by a factor:
--   lower_is_worse  → factor < 1 (stricter when continuous sample is reliable)
--   higher_is_worse → factor > 1 (permissive when noise is expected)
--
-- NOTE: contradicted_verdict_pct is NOT included on continuous because the
-- claim-attestation sample is too small on a nightly basis.
-- =============================================================================

-- ============================================================================
-- Table: eval_continuous_gate_thresholds
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eval_continuous_gate_thresholds (
  metric     varchar(64) PRIMARY KEY,
  factor     double precision NOT NULL,
  fail_at    double precision NOT NULL,
  warn_at    double precision NOT NULL,
  direction  varchar(8) NOT NULL
    CONSTRAINT eval_continuous_direction_chk
      CHECK (direction IN ('lower_is_worse', 'higher_is_worse'))
);

-- ============================================================================
-- Seed Data
-- Derived from CI thresholds with per-direction scaling factors.
--
-- lower_is_worse  metrics → factor < 1 (0.85–0.95, slightly stricter)
-- higher_is_worse metrics → factor > 1 (1.05–1.5, more permissive)
--
-- CI thresholds (reference):
--   answer_correct              : pass=0.85, warn=0.75, lower_is_worse
--   cite_precision             : pass=0.80, warn=0.70, lower_is_worse
--   recall_at_10               : pass=0.90, warn=0.80, lower_is_worse
--   false_handoff_rate         : pass=0.05, warn=0.10, higher_is_worse
--   p95_first_token_latency_ms : pass=800,  warn=1500, higher_is_worse
-- ============================================================================

INSERT INTO public.eval_continuous_gate_thresholds
  (metric, factor, fail_at, warn_at, direction)
VALUES
  -- answer_correct: 5% tighter than CI (lower_is_worse → smaller is worse)
  --   CI fail=0.75, CI warn=0.85; continuous: 0.95× factor
  ('answer_correct',                    0.95, 0.95 * 0.75, 0.95 * 0.85, 'lower_is_worse'),
  -- cite_precision: 5% tighter than CI
  --   CI fail=0.70, CI warn=0.80; continuous: 0.95× factor
  ('cite_precision',                   0.95, 0.95 * 0.70, 0.95 * 0.80, 'lower_is_worse'),
  -- recall_at_10: 5% tighter than CI
  --   CI fail=0.80, CI warn=0.90; continuous: 0.95× factor
  ('recall_at_10',                      0.95, 0.95 * 0.80, 0.95 * 0.90, 'lower_is_worse'),
  -- false_handoff_rate: 5% more permissive than CI (higher_is_worse → larger is worse)
  --   CI fail=0.10, CI warn=0.05; continuous: 1.05× factor
  ('false_handoff_rate',               1.05, 1.05 * 0.10, 1.05 * 0.05, 'higher_is_worse'),
  -- p95_first_token_latency_ms_delta: 50% more permissive than CI
  --   CI fail=1500ms, CI warn=800ms; continuous: 1.5× factor
  ('p95_first_token_latency_ms_delta', 1.5,  1.5  * 1500, 1.5  * 800, 'higher_is_worse')
ON CONFLICT (metric) DO NOTHING;

-- ============================================================================
-- Table-level comments
-- ============================================================================

COMMENT ON TABLE public.eval_continuous_gate_thresholds IS
  'Relaxed pass/warn thresholds for continuous (nightly) RAG evaluation. '
  'Thresholds are scaled from CI (commit integration) thresholds via the factor column. '
  'Metrics with direction=lower_is_worse use factor < 1 (slightly stricter); '
  'direction=higher_is_worse uses factor > 1 (more permissive). '
  'NOTE: contradicted_verdict_pct is excluded because the nightly '
  'claim-attestation sample is too small for reliable measurement.';

COMMENT ON COLUMN public.eval_continuous_gate_thresholds.factor IS
  'Multiplier applied to the CI threshold to derive the continuous threshold. '
  'Values < 1.0 for lower_is_worse (stricter); > 1.0 for higher_is_worse (permissive).';

COMMENT ON COLUMN public.eval_continuous_gate_thresholds.fail_at IS
  'Below this value the continuous eval run FAILS (exit code 1 / alert). '
  'Computed as factor × CI_fail_threshold.';

COMMENT ON COLUMN public.eval_continuous_gate_thresholds.warn_at IS
  'Below/above this value the continuous eval run WARNs (advisory only). '
  'Computed as factor × CI_warn_threshold.';

COMMENT ON COLUMN public.eval_continuous_gate_thresholds.direction IS
  'Whether lower values are worse (e.g. accuracy) or higher values are worse '
  '(e.g. latency, false_handoff_rate).';

-- ============================================================================
-- Privileges — revoke PUBLIC, grant service_role (per project convention)
-- ============================================================================

REVOKE ALL ON public.eval_continuous_gate_thresholds FROM PUBLIC;
GRANT  ALL ON public.eval_continuous_gate_thresholds TO service_role;

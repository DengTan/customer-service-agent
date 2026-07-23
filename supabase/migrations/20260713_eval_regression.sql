-- =============================================================================
-- Migration: 20260713_eval_regression.sql
-- Phase: P4 RAG Evaluation Framework
-- Task: Phase 4.1 — Eval Regression Migration
--
-- Creates two tables for regression-test gate management:
--
--   eval_gate_thresholds   — per-metric pass/warn/fail boundaries used to
--                             determine whether a regression run passes or fails.
--
--   eval_regression_runs   — one row per regression run, recording the CI
--                             bounds for every metric and the overall status
--                             (pass / warn / fail).
--
-- Seed data populates the six known production metrics with conservative
-- initial thresholds.  These can be tuned without a schema migration.
-- =============================================================================

BEGIN;

-- ============================================================================
-- Table: eval_gate_thresholds
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eval_gate_thresholds (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metric      varchar(64) NOT NULL UNIQUE,
  fail_at     double precision NOT NULL,
  warn_at     double precision NOT NULL,
  direction     varchar(16) NOT NULL,
  description text         NOT NULL DEFAULT '',
  updated_by  varchar(36),
  updated_at  timestamptz  NOT NULL DEFAULT NOW(),

  CONSTRAINT eval_gate_direction_chk
    CHECK (direction IN ('lower_is_worse', 'higher_is_worse'))
);

COMMENT ON TABLE public.eval_gate_thresholds IS
  'Per-metric gate boundaries for regression-test pass/warn/fail decisions. '
  'direction controls whether a worse CI bound violates fail_at or warn_at.';

COMMENT ON COLUMN public.eval_gate_thresholds.metric IS
  'Metric name, e.g. answer_correct, cite_precision, recall_at_10.';

COMMENT ON COLUMN public.eval_gate_thresholds.fail_at IS
  'Value at which the gate FAILS.  Interpretation depends on direction: '
  'lower_is_worse → CI lower bound must exceed fail_at; '
  'higher_is_worse → CI upper bound must stay below fail_at.';

COMMENT ON COLUMN public.eval_gate_thresholds.warn_at IS
  'Value at which the gate WARNS (between warn_at and fail_at is warn state). '
  'Same direction semantics as fail_at.';

COMMENT ON COLUMN public.eval_gate_thresholds.direction IS
  'lower_is_worse  = score degrades when CI lower bound falls below threshold; '
  'higher_is_worse  = score degrades when CI upper bound exceeds threshold.';

COMMENT ON COLUMN public.eval_gate_thresholds.updated_at IS
  'Auto-updated on every row change; no trigger needed — DEFAULT NOW() handles it.';

-- ============================================================================
-- Table: eval_regression_runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eval_regression_runs (
  id                 varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dataset_version_id varchar(36) NOT NULL
    REFERENCES public.eval_dataset_versions(id) ON DELETE CASCADE,

  run_kind    varchar(16) NOT NULL,
  status      varchar(8)  NOT NULL,

  -- JSONB shape:
  -- {
  --   "answer_correct": { "value": 0.89, "ci_lower": 0.83, "ci_upper": 0.95, "threshold": 0.75 },
  --   "cite_precision": { "value": 0.91, "ci_lower": 0.87, "ci_upper": 0.95, "threshold": 0.70 },
  --   ...
  -- }
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,

  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL,
  triggered_by   varchar(36),

  CONSTRAINT eval_regression_run_kind_chk
    CHECK (run_kind IN ('ci', 'continuous', 'manual')),
  CONSTRAINT eval_regression_status_chk
    CHECK (status IN ('pass', 'warn', 'fail'))
);

-- Efficient lookup by run kind (most common query: "latest CI run", "history of manual runs")
CREATE INDEX IF NOT EXISTS eval_regression_kind_idx
  ON public.eval_regression_runs (run_kind, started_at DESC);

-- Fast link back to the dataset version
CREATE INDEX IF NOT EXISTS eval_regression_dataset_version_id_idx
  ON public.eval_regression_runs (dataset_version_id);

COMMENT ON TABLE public.eval_regression_runs IS
  'One row per regression run.  status is derived from the CI bounds of every '
  'metric against the rows in eval_gate_thresholds.  run_kind = ci | continuous | manual.';

COMMENT ON COLUMN public.eval_regression_runs.run_kind IS
  'ci         = triggered by a CI pipeline on every PR merge; '
  'continuous = periodic health-check runs on a schedule; '
  'manual     = on-demand run triggered by a developer.';

COMMENT ON COLUMN public.eval_regression_runs.status IS
  'Derived: pass = all metrics CI bounds pass their thresholds; '
  'warn = at least one metric in warn band, none failing; '
  'fail = at least one metric CI bound violates fail_at.';

COMMENT ON COLUMN public.eval_regression_runs.metrics IS
  'JSONB map of metric → { value, ci_lower, ci_upper, threshold }. '
  'threshold mirrors the current eval_gate_thresholds value at run time.';

COMMENT ON COLUMN public.eval_regression_runs.triggered_by IS
  'UUID of the user who triggered a manual run; NULL for ci/continuous runs.';

-- ============================================================================
-- Seed: eval_gate_thresholds
-- ============================================================================

INSERT INTO public.eval_gate_thresholds
  (metric, fail_at, warn_at, direction, description)
VALUES
  ( 'answer_correct',                    0.75, 0.85, 'lower_is_worse',
    'answer correctness (CI lower bound)' ),
  ( 'cite_precision',                    0.70, 0.80, 'lower_is_worse',
    'cite precision (CI lower bound)' ),
  ( 'recall_at_10',                      0.80, 0.90, 'lower_is_worse',
    'recall@10 (CI lower bound)' ),
  ( 'false_handoff_rate',                0.10, 0.05, 'higher_is_worse',
    'false handoff rate (CI upper bound)' ),
  ( 'contradicted_verdict_pct',          0.15, 0.08, 'higher_is_worse',
    '% of attested claims contradicted' ),
  ( 'p95_first_token_latency_ms_delta',  1500, 800,  'higher_is_worse',
    'P95 latency delta vs baseline (ms)' )
ON CONFLICT (metric) DO NOTHING;

-- ============================================================================
-- Privileges — revoke PUBLIC, grant service_role (per project convention)
-- ============================================================================

REVOKE ALL ON public.eval_gate_thresholds    FROM PUBLIC;
REVOKE ALL ON public.eval_regression_runs    FROM PUBLIC;

GRANT  ALL ON public.eval_gate_thresholds    TO service_role;
GRANT  ALL ON public.eval_regression_runs    TO service_role;

COMMIT;

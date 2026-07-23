-- =============================================================================
-- Migration: 20260713_eval_calibration.sql
-- Phase: P4 RAG Evaluation Framework
-- Task: Phase 2.1 — Eval Calibration Migration
--
-- Creates the eval_calibration_settings table that stores per-slice calibration
-- slices for RAG evaluation. A "slice" is the combination of:
--   (bot_id, shop_id, dataset_version_id, status)
-- Each slice holds the 5-fold CV score profile for a given (bot, shop, dataset)
-- combination, including answer-correctness, cite-precision, recall, false-handoff
-- rate, composite score, and fold-gap (anti-overfit max-min spread).
--
-- Slices follow a status lifecycle: frozen -> canary -> active -> archived.
-- Only one non-archived slice per (bot_id, shop_id, dataset_version_id) can
-- be in non-frozen state at any time.
-- =============================================================================

-- ============================================================================
-- Table: eval_calibration_settings
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eval_calibration_settings (
  -- Primary key
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Slice dimensions
  dataset_version_id varchar(36) NOT NULL
    REFERENCES public.eval_dataset_versions(id) ON DELETE CASCADE,

  bot_id varchar(36) NOT NULL
    REFERENCES public.bot_configs(id) ON DELETE CASCADE,

  -- NULL means this slice covers all shops of this bot (a per-bot default)
  shop_id varchar(36)
    REFERENCES public.shops(id) ON DELETE CASCADE,

  -- Retrieval gating thresholds
  min_score              double precision NOT NULL,
  rerank_backend         varchar(16)     NOT NULL,
  claim_verifier_threshold double precision NOT NULL,
  confidence_gate        double precision NOT NULL,

  -- Per-dimension 5-fold CV scores
  answer_correct   double precision NOT NULL,
  cite_precision  double precision NOT NULL,
  recall_at_10    double precision NOT NULL,

  -- Routing correctness
  false_handoff_rate double precision NOT NULL,

  -- Aggregated scores
  composite double precision NOT NULL,

  -- Anti-overfit: max-min across the 5 folds (higher = less stable)
  fold_gap double precision NOT NULL,

  -- Lifecycle: frozen | canary | active | archived
  status varchar(16) NOT NULL DEFAULT 'frozen'
    CONSTRAINT eval_calibration_status_chk
      CHECK (status IN ('frozen', 'canary', 'active', 'archived')),

  -- Canary rollout (only applies when status = 'canary')
  is_canary boolean NOT NULL DEFAULT false,
  canary_pct integer NOT NULL DEFAULT 0
    CONSTRAINT eval_calibration_canary_pct_chk
      CHECK (canary_pct BETWEEN 0 AND 100),

  -- Per-fold metric detail (array of 5 fold objects with sub-scores)
  fold_detail jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Audit fields
  created_by  varchar(36),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  promoted_at timestamptz,

  -- Unique constraint: only one non-archived slice per (bot, shop, dataset)
  CONSTRAINT eval_calibration_unique_slice
    UNIQUE (bot_id, shop_id, dataset_version_id, status)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Efficient lookup by slice key (most common query: "what is the active slice?")
CREATE INDEX IF NOT EXISTS eval_calibration_slice_idx
  ON public.eval_calibration_settings (bot_id, shop_id);

-- Fast filter by lifecycle status
CREATE INDEX IF NOT EXISTS eval_calibration_status_idx
  ON public.eval_calibration_settings (status);

-- ============================================================================
-- Table-level comments
-- ============================================================================

COMMENT ON TABLE public.eval_calibration_settings IS
  'Per-slice 5-fold calibration scores for RAG evaluation. '
  'A slice = (bot_id, shop_id, dataset_version_id, status). '
  'Status lifecycle: frozen -> canary -> active -> archived.';

COMMENT ON COLUMN public.eval_calibration_settings.shop_id IS
  'NULL means this slice covers all shops of this bot (a per-bot default calibration).';

COMMENT ON COLUMN public.eval_calibration_settings.rerank_backend IS
  'Reranking backend used when this slice was evaluated: mock | bge | cohere | generic.';

COMMENT ON COLUMN public.eval_calibration_settings.canary_pct IS
  'Percentage of live traffic exposed to the canary calibration slice (0-100).';

COMMENT ON COLUMN public.eval_calibration_settings.fold_detail IS
  'JSON array of per-fold metric objects, e.g. '
  '[{fold:1, answer_correct:0.88, cite_precision:0.91, recall:0.84}, ...]. '
  'Used for statistical analysis and detecting overfitting.';

COMMENT ON COLUMN public.eval_calibration_settings.promoted_at IS
  'Timestamp when this slice was promoted to active status. NULL if never promoted.';

-- ============================================================================
-- Privileges — revoke PUBLIC, grant service_role (per project convention)
-- ============================================================================

REVOKE ALL ON public.eval_calibration_settings FROM PUBLIC;
GRANT  ALL ON public.eval_calibration_settings TO service_role;

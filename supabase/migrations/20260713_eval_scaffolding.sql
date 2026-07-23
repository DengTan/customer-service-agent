-- =============================================================================
-- Phase 0.1: Feature-flag & dataset scaffolding
-- Creates feature_flags table and eval_dataset_versions table for RAG evaluation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. feature_flags: key/value store for project-wide feature flags
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key          varchar(100) PRIMARY KEY,
  value        varchar(50)  NOT NULL DEFAULT 'false',
  description  text         NOT NULL DEFAULT '',
  updated_by   varchar(36),
  updated_at   timestamptz   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.feature_flags IS
  'Project-wide feature toggles. value is ''true'' / ''false'' or a scalar string.';

-- -----------------------------------------------------------------------------
-- 2. eval_dataset_versions: dataset version manifest
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.eval_dataset_versions (
  id                    varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  version               integer     NOT NULL UNIQUE,
  status                varchar(16) NOT NULL DEFAULT 'draft'
    CONSTRAINT eval_dataset_versions_status_chk
    CHECK (status IN ('draft', 'golden', 'archived')),
  rubric                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  bot_ids               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  turn_count            integer     NOT NULL DEFAULT 0,
  composite_score_target double precision,
  created_by            varchar(36),
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  frozen_at             timestamptz
);

COMMENT ON TABLE public.eval_dataset_versions IS
  'Versioned dataset manifests for RAG evaluation. ''draft'' -> ''golden'' -> ''archived'' lifecycle.';

CREATE INDEX IF NOT EXISTS eval_dataset_versions_status_idx
  ON public.eval_dataset_versions (status);

-- -----------------------------------------------------------------------------
-- 3. Extend test_cases: add eval_dataset_version_id foreign key
-- -----------------------------------------------------------------------------
ALTER TABLE public.test_cases
  ADD COLUMN IF NOT EXISTS eval_dataset_version_id varchar(36)
    REFERENCES public.eval_dataset_versions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.test_cases.eval_dataset_version_id IS
  'Links a test case to a specific eval_dataset_versions manifest. '
  'NULL means the case is not yet assigned to any evaluation dataset.';

CREATE INDEX IF NOT EXISTS test_cases_eval_dataset_version_id_idx
  ON public.test_cases (eval_dataset_version_id)
  WHERE eval_dataset_version_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Privileges — revoke PUBLIC, grant service_role (per project convention)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.feature_flags FROM PUBLIC;
REVOKE ALL ON public.eval_dataset_versions FROM PUBLIC;
REVOKE ALL ON public.test_cases FROM PUBLIC;

GRANT ALL ON public.feature_flags TO service_role;
GRANT ALL ON public.eval_dataset_versions TO service_role;
-- test_cases already has grants; re-grant to be safe
GRANT ALL ON public.test_cases TO service_role;

-- Migration: Remove priority columns from llm_providers and llm_models
-- Date: 2026-07-31
-- Description: Since provider selection uses is_default flag and model selection iterates through enabled models,
-- the priority columns are no longer needed. This migration removes them.

-- Drop indexes on priority columns first
DROP INDEX IF EXISTS llm_providers_priority_idx;
DROP INDEX IF EXISTS llm_models_priority_idx;
DROP INDEX IF EXISTS llm_models_select_idx;

-- Remove priority column from llm_providers table
ALTER TABLE llm_providers DROP COLUMN IF EXISTS priority;

-- Remove priority column from llm_models table
ALTER TABLE llm_models DROP COLUMN IF EXISTS priority;

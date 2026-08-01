-- Remove default_model column from llm_providers table
-- This column is no longer needed since models[0] is used as default everywhere

ALTER TABLE llm_providers DROP COLUMN IF EXISTS default_model;

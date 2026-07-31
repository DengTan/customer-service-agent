-- Migration: Convert source_context from text to jsonb
-- Date: 2026-07-30
-- Description: Change source_context column type from text to jsonb for structured gap metadata storage

-- Alter the column type from text to jsonb
ALTER TABLE knowledge_learning_queue
ALTER COLUMN source_context TYPE jsonb
USING CASE
  WHEN source_context IS NULL THEN NULL
  WHEN source_context::text ~ '^\\{' THEN source_context::jsonb
  ELSE jsonb_build_object('raw', source_context::text)
END;

-- Add comment
COMMENT ON COLUMN knowledge_learning_queue.source_context IS 'JSON object containing gap metadata: from_gap_id, from_gap_hash, from_gap_frequency';

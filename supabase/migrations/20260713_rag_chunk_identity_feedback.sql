-- Migration: Add chunk identity fields to knowledge_feedback table
-- Purpose: P2 - enable citation-level feedback precision with stable chunk keys
-- Author: P2 implementation
-- Created: 2026-07-13

BEGIN;

-- Add stable chunk identity columns to knowledge_feedback for P2 citation precision
ALTER TABLE knowledge_feedback
  ADD COLUMN IF NOT EXISTS chunk_id varchar(36),
  ADD COLUMN IF NOT EXISTS chunk_index integer,
  ADD COLUMN IF NOT EXISTS content_hash varchar(64);

-- Add index on chunk_id for fast lookup by chunk (future use)
CREATE INDEX IF NOT EXISTS knowledge_feedback_chunk_id_idx ON knowledge_feedback(chunk_id)
  WHERE chunk_id IS NOT NULL;

-- Add composite index for citation-level feedback queries
CREATE INDEX IF NOT EXISTS knowledge_feedback_citation_idx ON knowledge_feedback(knowledge_item_id, chunk_id)
  WHERE knowledge_item_id IS NOT NULL;

COMMIT;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload';

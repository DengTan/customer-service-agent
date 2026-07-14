-- ============================================
-- Remove deprecated chunk columns
-- 2026-07-09
--
-- Cleanup after Ollama embedding migration:
-- - doc_id: was used by Coze SDK, now obsolete (Ollama uses embedding column)
-- - parent_chunk_id: was for parent-child chunk architecture, never used
-- - chunk_level: same, never used
-- - doc_type: same, never used
-- ============================================

-- Drop indexes first (dependent on columns)
DROP INDEX IF EXISTS idx_knowledge_chunks_parent_id;
DROP INDEX IF EXISTS kc_parent_chunk_id_idx;
DROP INDEX IF EXISTS kc_level_idx;
DROP INDEX IF EXISTS kc_doc_type_idx;

-- Drop deprecated columns from knowledge_chunks
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS doc_id;
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS parent_chunk_id;
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS chunk_level;
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS doc_type;

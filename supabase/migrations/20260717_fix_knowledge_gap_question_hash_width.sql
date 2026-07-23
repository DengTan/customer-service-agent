-- Fix: knowledge_gap_signals.question_hash column width is too small
-- SHA-256 hash format is v1: + 64 chars = 67 chars, but column was varchar(100)
-- with unique constraint. Changed to varchar(128) for safety margin.
-- Also updated comment to reflect actual prefix used in code (v1: not gap_sha256_)

ALTER TABLE knowledge_gap_signals
ALTER COLUMN question_hash TYPE varchar(128);

COMMENT ON COLUMN knowledge_gap_signals.question_hash IS 'SHA-256(归一化问题)，前缀 v1: + 64字符 hash';

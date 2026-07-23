-- =============================================================================
-- Migration: 20260717_conversation_ai_processing_status.sql
-- Purpose: Add AI processing status tracking to conversations.
--          Mirrors the simulation_conversations fix: "AI 正在回复" state is now
--          a database column, not just a heuristic derived from last message role.
--          This ensures the status survives page navigation / component remount.
--
-- Bug fixed: "AI 正在回复切走页面后再回来一直显示" (真实对话路径)
--
-- Columns:
--   ai_processing            BOOLEAN: true while POST /messages is actively
--                                      generating an assistant reply for this conversation.
--   ai_processing_started_at TIMESTAMPTZ: when ai_processing was set to true.
--                                        Used for stale detection (>5 min = false).
-- =============================================================================

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS ai_processing BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS ai_processing_started_at TIMESTAMPTZ;

-- Partial index for finding stale processing states
CREATE INDEX IF NOT EXISTS conversations_ai_processing_idx
  ON conversations(ai_processing_started_at)
  WHERE ai_processing = TRUE;

COMMENT ON COLUMN conversations.ai_processing IS
  'True while an LLM stream is actively generating a response for this conversation.';
COMMENT ON COLUMN conversations.ai_processing_started_at IS
  'Timestamp when ai_processing was set to true. Used for stale detection (>5min = treat as false).';

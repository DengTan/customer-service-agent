-- =============================================================================
-- Migration: 20260717_simulation_ai_processing_status.sql
-- Purpose: Add AI processing status tracking to simulation_conversations.
--          This makes "AI is currently generating a response" a first-class
--          database state, eliminating the race condition where the UI shows
--          "AI 正在回复" stuck because the frontend component unmounted
--          during streaming and lost its React state.
--
-- Bug fixed: "模拟测试中，AI 正在回复切走页面后再回来一直显示"
--
-- Columns:
--   ai_processing            BOOLEAN: true while a POST /messages request is
--                                      actively generating an assistant reply
--                                      for this conversation.
--   ai_processing_started_at TIMESTAMPTZ: when ai_processing was last set to
--                                        true. Combined with a stale check
--                                        (>5 min), this provides self-healing
--                                        recovery if a server crashes mid-stream.
-- =============================================================================

ALTER TABLE simulation_conversations
ADD COLUMN IF NOT EXISTS ai_processing BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE simulation_conversations
ADD COLUMN IF NOT EXISTS ai_processing_started_at TIMESTAMPTZ;

-- Partial index for finding stale processing states (e.g. for admin cleanup)
CREATE INDEX IF NOT EXISTS simulation_conversations_ai_processing_idx
  ON simulation_conversations(ai_processing_started_at)
  WHERE ai_processing = TRUE;

COMMENT ON COLUMN simulation_conversations.ai_processing IS
  'True while an LLM stream is actively generating a response for this conversation. Frontend UI should reflect this state directly.';
COMMENT ON COLUMN simulation_conversations.ai_processing_started_at IS
  'Timestamp when ai_processing was set to true. Used for stale detection (>5min = treat as false).';

-- Backfill: any existing conversations default to ai_processing=false (already covered by DEFAULT FALSE).

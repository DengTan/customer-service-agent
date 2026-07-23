-- Sprint 2 / G-3: dedup index for Gorgias handoff alerts.
--
-- Background (see SECURITY_RISK_REGISTER.md → G-3):
--   gorgias-sync-service.ts → createHandoffAlert() had no uniqueness
--   constraint. A replayed handoff event, a retried webhook delivery, or
--   a concurrent re-processing of the same ticket would each spawn their
--   own row in `alerts`. The dashboard then showed multiple "Gorgias
--   工单 #N 已转人工处理" entries for the same conversation.
--
-- Sprint 1's `idempotent()` wrapper (scope=memory) protects within a
-- single Node process; this unique index is the cross-instance /
-- cross-process safety net so two replicas — or one replica that has
-- restarted between events — cannot each insert a duplicate row.
--
-- Migration shape (expression index):
--   * Only rows where type = 'gorgias_handoff' AND metadata contains the
--     'gorgias_ticket_id' key participate.
--   * The dedup tuple is (conversation_id, type, metadata->>'gorgias_ticket_id').
--     This is intentionally the same tuple the application uses for
--     idempotency so the unique index is a strict superset of the
--     in-memory check.
--   * The `WHERE` clause keeps the index small: ordinary alerts
--     (low_confidence, high_turns, etc.) are not affected.

-- Step 1: deduplicate any pre-existing rows so the index can be created.
-- We keep the OLDEST row (smallest created_at) per
-- (conversation_id, type, gorgias_ticket_id) tuple and delete the rest.
-- This is defensive: the production alert table should not contain
-- duplicates at the time of migration, but the index creation would
-- fail if any exist.
DELETE FROM alerts a1
USING alerts a2
WHERE a1.type = 'gorgias_handoff'
  AND a2.type = 'gorgias_handoff'
  AND a1.metadata ? 'gorgias_ticket_id'
  AND a2.metadata ? 'gorgias_ticket_id'
  AND a1.conversation_id IS NOT DISTINCT FROM a2.conversation_id
  AND a1.metadata->>'gorgias_ticket_id' = a2.metadata->>'gorgias_ticket_id'
  AND a1.created_at > a2.created_at;

-- Step 2: create the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_gorgias_handoff_dedup_idx
  ON alerts (
    conversation_id,
    type,
    (metadata->>'gorgias_ticket_id')
  )
  WHERE type = 'gorgias_handoff'
    AND metadata ? 'gorgias_ticket_id';

COMMENT ON INDEX alerts_gorgias_handoff_dedup_idx IS
  'Sprint 2 / G-3: ensures at most one gorgias_handoff alert per (conversation, ticket).';
-- Improve performance of CustomerService.listAccessibleCustomers after the
-- 2026-08-01 N+1 refactor. The new query uses participant_ids cs. '[uuid]'
-- (JSONB containment) to check actor access at the SQL level; this requires
-- a GIN index because the column is otherwise scanned sequentially.
CREATE INDEX IF NOT EXISTS conversations_participant_ids_gin_idx
  ON conversations USING gin (participant_ids jsonb_path_ops);

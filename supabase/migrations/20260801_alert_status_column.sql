-- =============================================================================
-- Sprint 5 / AL-2 — wire the alert state machine (`src/lib/alert-state-machine.ts`)
-- into the alerts table. The state machine was previously dead code because the
-- table only stored `is_resolved` (boolean) and `metadata.dismissed_at` (jsonb)
-- which left `dismissed` and `resolved` indistinguishable to query paths.
--
-- After this migration:
--   status           varchar(20) NOT NULL DEFAULT 'open'
--                    one of: 'open' | 'resolved' | 'dismissed'
--   metadata.dismissed_at  removed from rows whose status='dismissed' (the
--                    state column is now the single source of truth)
--
-- The new partial index speeds up the common Dashboard filter
-- "WHERE status = 'open' AND is_resolved = false" without bloating the index
-- with terminal-state rows.
-- =============================================================================

-- 1. Add status column (default 'open')
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'open';

-- 2. Backfill: previously resolved rows map to status='resolved'
UPDATE alerts
SET status = 'resolved'
WHERE is_resolved = true AND status = 'open';

-- 3. Clean dirty data: rows with metadata.dismissed_at but is_resolved=false were
--    operator-acknowledged noise but never reflected in the boolean. Promote them
--    to status='dismissed' and strip the legacy metadata key so the state column
--    becomes the single source of truth.
UPDATE alerts
SET status = 'dismissed'
WHERE is_resolved = false
  AND metadata ? 'dismissed_at'
  AND status = 'open';

UPDATE alerts
SET metadata = metadata - 'dismissed_at'
WHERE status = 'dismissed';

-- 4. Partial index: frequent Dashboard filter (status='open' AND is_resolved=false).
--    The partial predicate keeps the index small since the vast majority of rows
--    in steady state are either resolved or dismissed.
CREATE INDEX IF NOT EXISTS alerts_status_idx
  ON alerts (status) WHERE is_resolved = false;

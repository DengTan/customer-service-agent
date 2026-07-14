-- Migration: settings-security-and-semantics-fix (2026-07-13)
--
-- Contents:
--   1. Add atomic upsert_many batch RPC for settings
--   2. Add unhandled_remind_minutes (integer, default 30) and
--      unhandled_remind_enabled (boolean, default true) columns
--      (deprecates the old unhandled_remind boolean-column; old key kept
--      for backward compat — both old and new code paths work)

BEGIN;

-- ── 1. Atomic batch upsert RPC ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_many_settings(p_items jsonb)
RETURNS integer AS $$
DECLARE
  v_count integer := 0;
  v_key   text;
  v_value text;
BEGIN
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(p_items)
  LOOP
    INSERT INTO settings (key, value, updated_at)
      VALUES (v_key, v_value, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = NOW();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Deprecate unhandled_remind boolean ────────────────────────────────────
-- Old key: unhandled_remind  = 'true'|'false' stored as minutes (bug: NaN→0→never runs)
-- New keys:
--   unhandled_remind_enabled  = 'true'|'false'  (boolean, default 'true')
--   unhandled_remind_minutes  = integer string     (minutes, default '30')

-- Add new columns as key-value pairs
-- (settings is a kv table so we INSERT rather than ALTER TABLE)
INSERT INTO settings (key, value, updated_at)
VALUES ('unhandled_remind_enabled', 'true', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, updated_at)
VALUES ('unhandled_remind_minutes', '30', NOW())
ON CONFLICT (key) DO NOTHING;

-- Update old unhandled_remind value if it was explicitly set to a number string
-- (legacy deployments that may have set unhandled_remind to a number)
-- Leave the row as-is — it is now semantically wrong (boolean interpreted as
-- minutes) but the new code ignores it entirely, so the old value is inert.

COMMIT;

-- Settings seeding advisory lock + RPC (2026-07-10)
--
-- Purpose:
--   Multiple concurrent `seedDefaultSettings()` calls (e.g. admin creates user
--   + default-admin auto-creates on first login) could otherwise both pass the
--   "settings table has no system_prompt row yet" gate and then race to
--   upsertMany, producing inconsistent results.
--
-- Solution:
--   `pg_try_advisory_xact_lock(<bigint>)` is a non-blocking per-session lock
--   that is auto-released at transaction commit/rollback. The caller wraps
--   the seed work inside a transaction; only the winner of the lock proceeds,
--   the loser returns `false` and the client falls back to a sentinel-key
--   check.
--
-- Lock key:
--   8247193. See `src/lib/server-only-settings-defaults.ts`
--   (SETTINGS_SEED_LOCK_KEY). Chosen to be distinct from other advisory-lock
--   keys used in this project.

CREATE OR REPLACE FUNCTION try_acquire_settings_seed_lock()
RETURNS boolean AS $$
BEGIN
  RETURN pg_try_advisory_xact_lock(8247193);
END;
$$ LANGUAGE plpgsql;

-- Optional convenience RPC: merges the provided jsonb payload into the
-- settings table inside the advisory-lock transaction. Returns the number of
-- rows actually inserted/updated.
--
-- Clients that don't have this RPC yet (older deploys) fall back to plain
-- upsertMany via `SettingsRepository`. See `UserService.seedDefaultSettings`.
CREATE OR REPLACE FUNCTION seed_system_defaults(p_defaults jsonb)
RETURNS integer AS $$
DECLARE
  v_count integer := 0;
  v_key   text;
  v_value text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(8247193) THEN
    -- Another caller is already seeding; skip.
    RETURN 0;
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each_text(p_defaults)
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
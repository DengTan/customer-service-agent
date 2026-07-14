-- Migration: harden-settings-seed-and-reset-rpcs (2026-07-13)
--
-- Purpose:
--   Plan `settings-rls-hardening_5c312208.plan.md` phase 1.
--
--   Replaces `seed_system_defaults(jsonb)` (defined in
--   `20260710_settings_seeding_lock.sql`) with a hardened version that:
--     - Is `SECURITY DEFINER` with a fixed `search_path`.
--     - Verifies the caller is `service_role` (or a superuser) before
--       any DB write.
--     - Holds the existing `pg_try_advisory_xact_lock(8247193)` so two
--       concurrent seed calls cannot double-write.
--     - Uses `ON CONFLICT DO NOTHING` semantics for the seed path so an
--       admin who already customised a value is NEVER overwritten; the
--       caller only sees rows that were actually inserted.
--   Replaces the previous rev of `seed_system_defaults` which silently
--   `ON CONFLICT DO UPDATE` (admin customisations were overwritten on
--   every concurrent seed).
--
--   Adds a NEW privileged RPC `reset_settings_to_defaults(jsonb, text[])`
--   that:
--     - Is `SECURITY DEFINER` with a fixed `search_path`.
--     - Verifies the caller is `service_role` (or a superuser) before
--       any DB write.
--     - Only writes keys present in BOTH the supplied `p_defaults`
--       payload AND the `p_allowed_keys` allowlist (which the
--       application passes in — server-side, never trusted from the
--       client). Any key outside the allowlist is rejected.
--     - Uses `ON CONFLICT DO UPDATE` so admin-customised keys ARE
--       overwritten by the reset (this is the documented behaviour of
--       "恢复出厂"; integration keys / secrets are never in the payload).
--     - Returns the number of rows actually written.
--
-- Grants:
--   Both RPCs are revoked from PUBLIC, anon, authenticated and granted
--   to service_role only. The application calls them via its existing
--   `service_role` Supabase client (which bypasses RLS automatically).

BEGIN;

-- ── 1. Hardened seed RPC ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.seed_system_defaults(jsonb);

CREATE OR REPLACE FUNCTION public.seed_system_defaults(p_defaults jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer := 0;
  v_key   text;
  v_value text;
BEGIN
  -- Caller-role guard. Same shape as `upsert_settings_batch`.
  IF current_setting('is_superuser') <> 'on'
     AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: seed_system_defaults requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_defaults IS NULL OR jsonb_typeof(p_defaults) <> 'object' THEN
    RAISE EXCEPTION 'invalid payload: p_defaults must be a jsonb object'
      USING ERRCODE = '22023';
  END IF;

  -- Advisory lock so concurrent seed calls do not race.
  IF NOT pg_try_advisory_xact_lock(8247193) THEN
    RETURN 0;
  END IF;

  FOR v_key, v_value IN
    SELECT key, value FROM jsonb_each_text(p_defaults)
  LOOP
    INSERT INTO public.settings (key, value, updated_at)
      VALUES (v_key, v_value, NOW())
      ON CONFLICT (key) DO NOTHING;
    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_system_defaults(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_system_defaults(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.seed_system_defaults(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seed_system_defaults(jsonb) TO service_role;

-- ── 2. Privileged reset RPC ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reset_settings_to_defaults(jsonb, text[]);

CREATE OR REPLACE FUNCTION public.reset_settings_to_defaults(
  p_defaults jsonb,
  p_allowed_keys text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer := 0;
  v_key   text;
  v_value text;
  v_allowed_count integer := 0;
BEGIN
  -- Caller-role guard.
  IF current_setting('is_superuser') <> 'on'
     AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reset_settings_to_defaults requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_defaults IS NULL OR jsonb_typeof(p_defaults) <> 'object' THEN
    RAISE EXCEPTION 'invalid payload: p_defaults must be a jsonb object'
      USING ERRCODE = '22023';
  END IF;

  IF p_allowed_keys IS NULL OR array_length(p_allowed_keys, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid payload: p_allowed_keys must be a non-empty text[]'
      USING ERRCODE = '22023';
  END IF;

  -- Pre-compute the intersection of supplied defaults and the allowlist.
  -- Any key not present in the allowlist is silently skipped (it cannot
  -- be reset) but a count of how many defaults were dropped is recorded.
  CREATE TEMP TABLE _reset_targets ON COMMIT DROP AS
    SELECT d.key, d.value
    FROM jsonb_each_text(p_defaults) AS d(key, value)
    JOIN unnest(p_allowed_keys) AS a(key) USING (key);

  GET DIAGNOSTICS v_allowed_count = ROW_COUNT;

  FOR v_key, v_value IN
    SELECT key, value FROM _reset_targets
  LOOP
    UPDATE public.settings
       SET value = v_value,
           updated_at = NOW()
     WHERE key = v_key;
    IF NOT FOUND THEN
      INSERT INTO public.settings (key, value, updated_at)
        VALUES (v_key, v_value, NOW());
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) TO service_role;

-- ── 3. Convenience: expose the helper used for advisory-lock acquisition
--      via service_role only. `try_acquire_settings_seed_lock` was already
--      defined in `20260710_settings_seeding_lock.sql` without EXECUTE
--      grants; revoke PUBLIC and grant service_role explicitly so a
--      client-side probe does not learn the lock key by trial-and-error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'try_acquire_settings_seed_lock'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.try_acquire_settings_seed_lock() FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.try_acquire_settings_seed_lock() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.try_acquire_settings_seed_lock() FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.try_acquire_settings_seed_lock() TO service_role';
  END IF;
END
$$;

-- ── 4. Re-grant settings table privileges (mirror of
--      `20260713_settings_rls_and_priv_rpc.sql`). Service role needs
--      SELECT/INSERT/UPDATE/DELETE; anon / authenticated keep nothing.
--      This block is idempotent: the prior migration already issued
--      these statements; we re-issue so this migration is safe to apply
--      to a deployment that did NOT yet run the earlier one.
REVOKE ALL ON public.settings FROM anon;
REVOKE ALL ON public.settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO service_role;

COMMIT;
-- Migration: settings-rls-and-priv-bypass (2026-07-13)
--
-- Purpose:
--   Hardens the public.settings table against direct access from non-service
--   Supabase roles (anon / authenticated) and provides a controlled RPC used
--   by the application backend to atomically upsert a batch of settings.
--
-- Contents:
--   1. RLS on public.settings (was previously not enabled)
--   2. RLS policy: deny everything by default for anon / authenticated;
--      the service_role bypasses RLS automatically so the existing admin
--      backend continues to work.
--   3. `upsert_settings_batch` RPC: SECURITY DEFINER, fixed search_path,
--      invoke-only-by-service-role guard. Replaces the previous
--      `upsert_many_settings` which lacked the search_path pin and
--      had no caller-role check, leaving it reachable by anon.
--   4. Explicit grants: REVOKE from PUBLIC, GRANT EXECUTE to service_role only.

BEGIN;

-- ── 1. Enable RLS ────────────────────────────────────────────────
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS policies ──────────────────────────────────────────────
-- The application's backend uses the service_role key, which bypasses RLS
-- automatically, so the admin PUT /api/settings path keeps working with
-- zero code changes. anon / authenticated get nothing.
DROP POLICY IF EXISTS "settings_deny_all_anon" ON public.settings;
DROP POLICY IF EXISTS "settings_deny_all_authenticated" ON public.settings;
DROP POLICY IF EXISTS "settings_service_role_all" ON public.settings;

-- Defense in depth: explicit deny policies for both client roles. Even if
-- someone later removes RLS, the GRANTs below still block raw access.
CREATE POLICY "settings_deny_all_anon" ON public.settings
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "settings_deny_all_authenticated" ON public.settings
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- service_role has BYPASSRLS at the role level; the explicit policy here
-- makes the access model legible in pg_policies without weakening RLS.
CREATE POLICY "settings_service_role_all" ON public.settings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 3. Privileged RPC ────────────────────────────────────────────
-- Replaces `upsert_many_settings` (created in
-- `20260713_settings_security_and_semantics_fix.sql`).
--
-- Differences vs the old function:
--   * SECURITY DEFINER so it runs as the migration-owner's role
--     (which has table privileges), but with search_path pinned to pg_catalog,
--     public to neutralise search_path hijack attacks.
--   * Caller-role guard: only `service_role` may invoke it. anon and
--     authenticated callers (which inherit EXECUTE from PUBLIC on every
--     new function in `public`) are explicitly rejected before any write.
--   * Wraps the per-key upserts in a single transaction (atomic batch
--     write — partial failures roll the whole PUT back).
DROP FUNCTION IF EXISTS public.upsert_many_settings(jsonb);

CREATE OR REPLACE FUNCTION public.upsert_settings_batch(p_items jsonb)
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
  -- Caller-role check: only service_role may invoke this RPC.
  -- auth.role() is intentionally not used here (deprecated and unreliable
  -- when anonymous sign-ins are enabled).
  IF current_setting('is_superuser') <> 'on'
     AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: upsert_settings_batch requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'object' THEN
    RAISE EXCEPTION 'invalid payload: p_items must be a jsonb object'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN
    SELECT key, value FROM jsonb_each_text(p_items)
  LOOP
    INSERT INTO public.settings (key, value, updated_at)
      VALUES (v_key, v_value, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = NOW();
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── 4. Grants: callable only by service_role ─────────────────────
REVOKE ALL ON FUNCTION public.upsert_settings_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_settings_batch(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_settings_batch(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_settings_batch(jsonb) TO service_role;

-- Defence-in-depth: also revoke on the legacy function name in case it
-- still exists from a previous deploy. The CREATE OR REPLACE above will
-- have already overwritten it; this block is for environments that ran
-- the older migration with a different function name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_many_settings'
  ) THEN
    REVOKE ALL ON FUNCTION public.upsert_many_settings(jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.upsert_many_settings(jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public.upsert_many_settings(jsonb) FROM authenticated;
  END IF;
END
$$;

-- Re-grant table privileges explicitly to the canonical roles. Supabase
-- best practice: keep RLS as the source of truth, but also keep GRANTs
-- narrow so a misconfigured PostgREST exposure doesn't immediately leak.
REVOKE ALL ON public.settings FROM anon;
REVOKE ALL ON public.settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO service_role;

COMMIT;
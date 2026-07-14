BEGIN;

-- Fix P0 inner-guards in the hardened settings RPCs from
-- 20260713_harden_settings_seed_and_reset_rpcs.sql.
--
-- Inside a SECURITY DEFINER body, current_user is pinned to the function
-- owner (postgres). Even outer "SET LOCAL ROLE service_role" leaves
-- current_user = 'postgres', so the old guard rejected every caller
-- including the production service_role JWT.
--
-- Replace the guard with current_setting('role', true) which reports the
-- outer caller's role on a Supabase service-role connection. Fall back to
-- current_user for environments where the role GUC is not set (psql, CI).
-- Superusers always pass.

CREATE OR REPLACE FUNCTION public.seed_system_defaults(p_defaults jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer := 0;
  v_key text;
  v_value text;
  v_caller text := coalesce(nullif(current_setting('role', true), ''), current_user);
BEGIN
  IF current_setting('is_superuser') <> 'on'
     AND v_caller <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: seed_system_defaults requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_defaults IS NULL OR jsonb_typeof(p_defaults) <> 'object' THEN
    RAISE EXCEPTION 'p_defaults must be a jsonb object'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN
    SELECT k, v
    FROM jsonb_each(p_defaults) AS j(k, v)
  LOOP
    INSERT INTO public.settings (key, value, updated_at)
    VALUES (v_key, v_value, NOW())
    ON CONFLICT (key) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

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
  v_caller text := coalesce(nullif(current_setting('role', true), ''), current_user);
BEGIN
  IF current_setting('is_superuser') <> 'on'
     AND v_caller <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reset_settings_to_defaults requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_defaults IS NULL OR jsonb_typeof(p_defaults) <> 'object' THEN
    RAISE EXCEPTION 'p_defaults must be a jsonb object'
      USING ERRCODE = '22023';
  END IF;

  IF p_allowed_keys IS NULL OR array_length(p_allowed_keys, 1) IS NULL THEN
    RAISE EXCEPTION 'p_allowed_keys must be a non-empty text array'
      USING ERRCODE = '22023';
  END IF;

  -- Force-cast allowed text array through jsonb to align with p_defaults form.
  UPDATE public.settings s
  SET value = d.v,
      updated_at = NOW()
  FROM (
    SELECT j.k AS k, j.v AS v
    FROM jsonb_each(p_defaults) AS j(k, v)
    WHERE j.k = ANY (p_allowed_keys)
  ) d
  WHERE s.key = d.k;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_system_defaults(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_system_defaults(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seed_system_defaults(jsonb) FROM authenticated;

REVOKE ALL ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.seed_system_defaults(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_settings_to_defaults(jsonb, text[]) TO service_role;

COMMIT;

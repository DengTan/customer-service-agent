BEGIN;

CREATE OR REPLACE FUNCTION public.rotate_push_webhook_secret(p_new_value text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rotated_at timestamptz := clock_timestamp();
  v_caller_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: rotate_push_webhook_secret requires service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_value IS NULL OR length(p_new_value) < 43 THEN
    RAISE EXCEPTION 'invalid webhook secret: minimum length is 43 characters'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.settings (key, value, updated_at)
  VALUES ('push_webhook_secret', p_new_value, v_rotated_at)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;

  RETURN v_rotated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_push_webhook_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_push_webhook_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.rotate_push_webhook_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_push_webhook_secret(text) TO service_role;

COMMIT;

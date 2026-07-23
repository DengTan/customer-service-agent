-- Advisory lock for eval calibration runs.
-- Replaces the broken JS hashtext reimplementation in calibration/run/route.ts.
-- The lock key is computed inside PostgreSQL using the built-in hashtext()
-- so it always matches pg_advisory_xact_lock's internal computation.

CREATE OR REPLACE FUNCTION eval_calibration_slice_lock(p_bot_id uuid, p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  lock_key bigint;
BEGIN
  -- hashtext() is PostgreSQL's built-in hash function for text.
  -- Lock string format matches the JS version's format:
  -- 'eval_calibration:' || bot_id || ':' || coalesce(shop_id, '*')
  lock_key := hashtext(
    'eval_calibration:' || p_bot_id::text || ':' || coalesce(p_shop_id::text, '*')
  );
  PERFORM pg_advisory_xact_lock(lock_key);
END;
$$;

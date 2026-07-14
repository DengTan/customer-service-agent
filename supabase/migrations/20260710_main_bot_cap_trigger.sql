-- Main-bot cap enforcement at the database level
-- Prevents the same TOCTOU race the sub-agent trigger guards against:
-- two concurrent INSERTs both pass the application-level count and produce
-- an 11th main bot.
--
-- Only ACTIVE main bots count against the cap so admins can use disable
-- (instead of delete) to temporarily free up a slot. This mirrors the
-- behavior of the sub-agent cap and the application-level countActiveSubAgents
-- logic.
--
-- The cap value is read from the `settings` table (`max_main_bots` key) so
-- operators can adjust it without re-deploying SQL. A safe default of 10 is
-- used when the setting is missing or non-numeric; we never throw on the
-- settings lookup itself.
--
-- This is a defense-in-depth layer; the application code still runs a
-- pre-check so the common case returns a friendly 400 without an INSERT
-- round-trip.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_main_bot_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_count INTEGER;
  cap_value INTEGER := 10;
  raw_setting TEXT;
BEGIN
  -- Only enforce for main-bot rows. Sub-agents have is_sub_agent = true and
  -- do not contribute to the global main-bot cap.
  IF NEW.is_sub_agent IS DISTINCT FROM false THEN
    RETURN NEW;
  END IF;

  -- Only enforce when the row is (or just became) active. Disabled main
  -- bots do not count.
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  -- Resolve the active cap from settings. If the row is missing or the
  -- value is not a positive integer, fall back to the factory default of 10.
  -- Swallow exceptions on the lookup so a malformed settings row never
  -- bricks the bot_configs write path.
  BEGIN
    SELECT value INTO raw_setting FROM settings WHERE key = 'max_main_bots';
    IF raw_setting IS NOT NULL THEN
      BEGIN
        cap_value := GREATEST(1, LEAST(raw_setting::INTEGER, 1000));
      EXCEPTION WHEN OTHERS THEN
        cap_value := 10;
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    cap_value := 10;
  END;

  -- On UPDATE we exclude the row itself; otherwise a status flip from
  -- disabled -> active while sitting at the cap would always reject.
  SELECT COUNT(*) INTO active_count
  FROM bot_configs
  WHERE is_sub_agent = false
    AND status = 'active'
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF active_count >= cap_value THEN
    RAISE EXCEPTION
      '系统最多只能创建 % 个主Bot，当前已有 % 个',
      cap_value, active_count
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bot_configs_main_bot_cap ON bot_configs;
CREATE TRIGGER bot_configs_main_bot_cap
  BEFORE INSERT OR UPDATE OF status, is_sub_agent
  ON bot_configs
  FOR EACH ROW
  EXECUTE FUNCTION enforce_main_bot_cap();

COMMIT;

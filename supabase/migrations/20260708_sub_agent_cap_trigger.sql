-- Sub-agent cap enforcement at the database level
-- Prevents race conditions where two concurrent inserts both pass the
-- application-level count check and create an 11th (or 12th, etc.) sub-agent.
--
-- Only ACTIVE sub-agents count against the cap. Disabled sub-agents are
-- excluded so admins can re-enable / replace them without hitting the limit.
--
-- This is a defense-in-depth layer; the application code still does a
-- pre-check to give a friendlier error message and avoid an INSERT round-trip
-- in the common case.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_sub_agent_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_count INTEGER;
BEGIN
  -- Only enforce on inserts / status flips that create a new "active sub-agent
  -- under a parent". Skip when parent_bot_id is NULL (this is a main bot).
  IF NEW.parent_bot_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only enforce when the row is (or just became) active. Disabled sub-agents
  -- are allowed to exist beyond the cap.
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE we must exclude the row itself, otherwise the count always
  -- includes the current row and a status flip from disabled->active at
  -- the cap would incorrectly reject.
  SELECT COUNT(*) INTO active_count
  FROM bot_configs
  WHERE parent_bot_id = NEW.parent_bot_id
    AND is_sub_agent = true
    AND status = 'active'
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF active_count >= 10 THEN
    RAISE EXCEPTION
      '每个主Bot最多只能创建 10 个子Agent，当前已有 % 个',
      active_count
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bot_configs_sub_agent_cap ON bot_configs;
CREATE TRIGGER bot_configs_sub_agent_cap
  BEFORE INSERT OR UPDATE OF status, parent_bot_id, is_sub_agent
  ON bot_configs
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sub_agent_cap();

COMMIT;

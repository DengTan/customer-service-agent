-- Bot Config Update RPC: atomically update a bot config
-- - Clears is_default=true from all other bots in the same operation (prevents race)
-- - Clears platform_connection_id from bots bound to the same shop (prevents race)
-- - Updates the target bot in a single transaction
-- This replaces the 3-step application-level update in bot-config-repository.ts.

CREATE OR REPLACE FUNCTION upsert_bot_config(
  p_id               TEXT,
  p_name             TEXT,
  p_description      TEXT,
  p_system_prompt     TEXT,
  p_tools            JSONB,
  p_knowledge_ids    JSONB,
  p_skill_group_id   TEXT,
  p_is_default       BOOLEAN,
  p_parent_bot_id     TEXT,
  p_delegation_prompt TEXT,
  p_collaboration_config JSONB,
  p_is_sub_agent     BOOLEAN,
  p_status           TEXT,
  p_platform_connection_id TEXT,
  p_expected_updated_at TEXT   -- NULL = skip optimistic lock check
)
RETURNS bot_configs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_row bot_configs;
BEGIN
  -- Step 1: Clear is_default from all other bots (single write, atomic)
  IF p_is_default THEN
    UPDATE bot_configs SET is_default = false WHERE is_default = true;
  END IF;

  -- Step 2: If a shop binding is being set, clear existing binding first (single write, atomic)
  IF p_platform_connection_id IS NOT NULL AND p_platform_connection_id != '' THEN
    UPDATE bot_configs
    SET platform_connection_id = NULL,
        updated_at = NOW()
    WHERE platform_connection_id = p_platform_connection_id
      AND id != p_id;
  END IF;

  -- Step 3: Conditional update with optimistic lock
  UPDATE bot_configs SET
    name                   = COALESCE(p_name, name),
    description            = COALESCE(p_description, description),
    system_prompt         = COALESCE(p_system_prompt, system_prompt),
    tools                 = COALESCE(p_tools, tools),
    knowledge_ids         = COALESCE(p_knowledge_ids, knowledge_ids),
    skill_group_id        = COALESCE(p_skill_group_id, skill_group_id),
    is_default            = COALESCE(p_is_default, is_default),
    parent_bot_id         = p_parent_bot_id,
    delegation_prompt     = p_delegation_prompt,
    collaboration_config   = COALESCE(p_collaboration_config, collaboration_config),
    is_sub_agent          = COALESCE(p_is_sub_agent, is_sub_agent),
    status                = COALESCE(p_status, status),
    platform_connection_id = CASE
      WHEN p_platform_connection_id = '' THEN NULL
      ELSE p_platform_connection_id
    END,
    updated_at            = NOW()
  WHERE id = p_id
    AND (p_expected_updated_at IS NULL OR updated_at = p_expected_updated_at)
  RETURNING * INTO updated_row;

  -- If optimistic lock failed (expected_updated_at mismatch)
  IF updated_row IS NULL AND p_expected_updated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bot 已被并发更新，请刷新后重试'
      USING ERRCODE = 'P0001';
  END IF;

  -- If bot doesn't exist
  IF updated_row IS NULL THEN
    RAISE EXCEPTION 'Bot 不存在'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN updated_row;
END;
$$;

-- Grant execute to authenticated role (anon + service_role both use this)
GRANT EXECUTE ON FUNCTION upsert_bot_config TO anon, service_role;

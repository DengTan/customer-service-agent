-- Bot Configs indexes: fixes ORDER BY 400 errors in listSubAgents / list
-- and supports the FK embed query used by listMainBotsWithCounts.

BEGIN;

-- Index for ORDER BY created_at (required by PostgREST for sorted queries)
-- Supabase: tables > 5 rows REQUIRE index on ORDER BY column, otherwise 400
CREATE INDEX IF NOT EXISTS bot_configs_created_at_idx ON bot_configs(created_at);

-- Composite index for the most common sub-agent query pattern
CREATE INDEX IF NOT EXISTS bot_configs_sub_agent_parent_idx
  ON bot_configs(parent_bot_id, is_sub_agent)
  WHERE is_sub_agent = true;

-- Self-referential FK: allows PostgREST embed queries like
--   select('*, child_bots:bot_configs!parent_bot_id(count)')
-- Without this FK, PostgREST cannot resolve the embed relationship.
DO $$
BEGIN
  ALTER TABLE bot_configs
    ADD CONSTRAINT bot_configs_parent_bot_id_fkey
    FOREIGN KEY (parent_bot_id)
    REFERENCES bot_configs(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

COMMIT;

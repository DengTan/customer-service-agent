-- Bot Config Audit Log
-- Records every create / update / delete operation on bot_configs, including
-- who performed it, when, and what changed (old vs new values).
-- Mirrors the pattern of ticket_audit_log.

BEGIN;

CREATE TABLE IF NOT EXISTS bot_config_audit_log (
  id          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      VARCHAR(36) NOT NULL,
  action      VARCHAR(30) NOT NULL,       -- 'create' | 'update' | 'delete'
  actor_id    VARCHAR(36),               -- users.id of the operator (null = system)
  actor_name  VARCHAR(100),               -- denormalised name for quick display
  changes     JSONB,                      -- field-level diff: { field: { old, new } }
  old_value   JSONB,                      -- full row snapshot before change
  new_value   JSONB,                      -- full row snapshot after change (null on delete)
  metadata    JSONB,                      -- extra context (IP, reason, etc.)
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_config_audit_log_bot_id    ON bot_config_audit_log(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_config_audit_log_actor_id  ON bot_config_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_bot_config_audit_log_action   ON bot_config_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_bot_config_audit_log_created  ON bot_config_audit_log(created_at DESC);

COMMENT ON TABLE bot_config_audit_log IS 'Bot配置操作审计日志表';
COMMENT ON COLUMN bot_config_audit_log.bot_id     IS 'Bot配置的 id';
COMMENT ON COLUMN bot_config_audit_log.action     IS '操作类型：create | update | delete';
COMMENT ON COLUMN bot_config_audit_log.actor_id   IS '操作用户 ID';
COMMENT ON COLUMN bot_config_audit_log.actor_name  IS '操作用户名称';
COMMENT ON COLUMN bot_config_audit_log.changes     IS '变更字段及其旧/新值（仅记录实际变更的字段）';
COMMENT ON COLUMN bot_config_audit_log.old_value  IS '操作前的完整记录快照';
COMMENT ON COLUMN bot_config_audit_log.new_value  IS '操作后的完整记录快照（delete 时为 null）';
COMMENT ON COLUMN bot_config_audit_log.metadata   IS '附加上下文，如 IP 地址、删除原因等';

COMMIT;

-- Verification
DO $$
BEGIN
  RAISE NOTICE 'Migration completed. Created tables:';
  RAISE NOTICE '  - bot_config_audit_log';
END $$;

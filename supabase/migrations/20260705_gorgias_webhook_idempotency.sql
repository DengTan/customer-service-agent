-- Gorgias Webhook 幂等性检查表
-- 用于存储已处理的 Webhook 事件 ID，防止重复处理

-- 创建 webhook_event_processed 表
CREATE TABLE IF NOT EXISTS webhook_event_processed (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar(36),
  -- event_id: Gorgias Webhook 事件 ID（唯一索引）
  event_id varchar(100) NOT NULL,
  -- event_type: 事件类型
  event_type varchar(50) NOT NULL,
  -- object_id: 关联对象 ID（如工单 ID）
  object_id varchar(50),
  -- result: 处理结果：success / failed
  result varchar(20) NOT NULL DEFAULT 'success',
  -- error_message: 错误信息（如果有）
  error_message text,
  -- processed_at: 处理时间
  processed_at timestamptz NOT NULL DEFAULT NOW(),
  -- created_at: 创建时间
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- 创建唯一索引（防止同一事件重复处理）
CREATE UNIQUE INDEX IF NOT EXISTS webhook_event_processed_event_id_idx
  ON webhook_event_processed (event_id);

-- 创建普通索引（用于按事件类型查询）
CREATE INDEX IF NOT EXISTS webhook_event_processed_event_type_idx
  ON webhook_event_processed (event_type);

-- 创建索引（用于清理过期数据）
CREATE INDEX IF NOT EXISTS webhook_event_processed_processed_at_idx
  ON webhook_event_processed (processed_at);

COMMENT ON TABLE webhook_event_processed IS 'Gorgias Webhook 事件处理记录，用于幂等性检查';
COMMENT ON COLUMN webhook_event_processed.event_id IS 'Gorgias Webhook 事件 ID';
COMMENT ON COLUMN webhook_event_processed.event_type IS '事件类型：ticket-created / ticket-message-created / ticket-updated / ticket-handed-over';
COMMENT ON COLUMN webhook_event_processed.result IS '处理结果：success / failed';

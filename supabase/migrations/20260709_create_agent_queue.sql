-- Migration: Create agent_queue table
-- Date: 2026-07-09
-- Description: Create agent_queue table for managing human handoff queue

-- ============================================
-- Table: agent_queue - 坐席排队表
-- ============================================
CREATE TABLE IF NOT EXISTS agent_queue (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_name VARCHAR(100),
  priority VARCHAR(20) NOT NULL DEFAULT 'normal', -- urgent, normal
  skill_group_id VARCHAR(36),
  assigned_agent_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued, assigned, resolved
  reason TEXT, -- 转人工原因
  summary TEXT, -- 对话摘要
  source_platform VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  assigned_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_queue_status_idx ON agent_queue(status);
CREATE INDEX IF NOT EXISTS agent_queue_assigned_agent_id_idx ON agent_queue(assigned_agent_id);
CREATE INDEX IF NOT EXISTS agent_queue_created_at_idx ON agent_queue(created_at);

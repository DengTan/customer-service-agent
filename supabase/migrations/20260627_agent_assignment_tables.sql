-- Migration: Create agent_assignment_stats table if not exists
-- Date: 2026-06-27
-- Purpose: Ensure agent_assignment_stats table exists for agent assignment feature

BEGIN;

-- Create agent_assignment_stats table
CREATE TABLE IF NOT EXISTS agent_assignment_stats (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  assigned_count INT NOT NULL DEFAULT 0,
  active_conversations INT NOT NULL DEFAULT 0,
  completed_count INT NOT NULL DEFAULT 0,
  last_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agent_assignment_stats_user_date ON agent_assignment_stats(user_id, date);
CREATE INDEX IF NOT EXISTS idx_agent_assignment_stats_active_conversations ON agent_assignment_stats(active_conversations);

-- Create shop_agent_bindings table if not exists
CREATE TABLE IF NOT EXISTS shop_agent_bindings (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id VARCHAR(36) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_agent_bindings_shop ON shop_agent_bindings(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_agent_bindings_user ON shop_agent_bindings(user_id);

-- Create agent_assignment_config table if not exists
CREATE TABLE IF NOT EXISTS agent_assignment_config (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  condition_config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_assignment_config_strategy ON agent_assignment_config(strategy);
CREATE INDEX IF NOT EXISTS idx_agent_assignment_config_is_enabled ON agent_assignment_config(is_enabled);

COMMIT;

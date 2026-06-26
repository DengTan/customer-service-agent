-- Migration: Add missing columns and constraints
-- Date: 2026-06-26
-- Description: Add missing columns, FK constraints, indexes to match repository and AGENTS.md

-- ======== marketing_campaigns table ========
-- Add message_template column (消息模板)
ALTER TABLE marketing_campaigns
ADD COLUMN IF NOT EXISTS message_template TEXT;

-- Add trigger_type column (触发类型: manual/scheduled/event)
ALTER TABLE marketing_campaigns
ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(20) DEFAULT 'manual';

-- Add scheduled_at column (定时投放时间)
ALTER TABLE marketing_campaigns
ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- Add trigger_config column (触发配置JSON)
ALTER TABLE marketing_campaigns
ADD COLUMN IF NOT EXISTS trigger_config JSONB;

-- ======== conversations table ========
-- Add participant_ids column (协同参与者)
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS participant_ids JSONB;

-- Add is_collaborative column (是否协同会话)
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS is_collaborative BOOLEAN DEFAULT FALSE;

-- ======== knowledge_versions table ========
-- Add chunk_diff column (变更明细)
ALTER TABLE knowledge_versions
ADD COLUMN IF NOT EXISTS chunk_diff JSONB;

-- Add chunk_count column (当前chunk数)
ALTER TABLE knowledge_versions
ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0;

-- ======== shop_agent_accounts table ========
-- Add FK constraint to shops
ALTER TABLE shop_agent_accounts
ADD CONSTRAINT shop_agent_accounts_shop_id_fkey
FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

-- Add unique constraint on (shop_id, account_name)
ALTER TABLE shop_agent_accounts
ADD CONSTRAINT shop_agent_accounts_shop_account_unique
UNIQUE (shop_id, account_name);

-- ======== knowledge_gap_signals table ========
-- Increase question_hash column width to 100 (prefix + SHA-256 hash)
ALTER TABLE knowledge_gap_signals
ALTER COLUMN question_hash TYPE VARCHAR(100);

-- ======== Indexes for performance ========
-- Composite index for conversations (status, created_at) - helps export queries
CREATE INDEX IF NOT EXISTS conversations_status_created_idx
ON conversations(status, created_at);

-- Index for messages.role (frequently filtered)
CREATE INDEX IF NOT EXISTS messages_role_idx
ON messages(role);

-- Index for shop_agent_accounts.status (frequently filtered)
CREATE INDEX IF NOT EXISTS shop_agent_accounts_status_idx
ON shop_agent_accounts(status);

-- Index for conversations.is_collaborative
CREATE INDEX IF NOT EXISTS conversations_is_collaborative_idx
ON conversations(is_collaborative);

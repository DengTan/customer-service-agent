-- =============================================================================
-- SmartAssist 完整数据库迁移脚本
-- 对应 schema.ts 中所有表结构定义
--
-- 创建时间: 2026-06-26
-- 描述: 补全 schema.ts 中已定义但 init-database.sql 中缺失的所有表和索引
--
-- 执行方式:
--   方式1: Supabase Dashboard > SQL Editor > 粘贴执行
--   方式2: psql 命令行: psql $DATABASE_URL -f 20260626_complete_schema.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1: 补全 init-database.sql 中已创建但列不完整的表（ADD COLUMN IF NOT EXISTS）
-- =============================================================================

-- ---- conversations ----
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ---- messages ----
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ---- marketing_campaigns ----
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS message_template TEXT;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(20) DEFAULT 'manual';
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS trigger_config JSONB;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS ab_variants JSONB;

-- ---- knowledge_items ----
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS parent_category VARCHAR(100);
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS hit_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS adopted_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS rejected_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ---- knowledge_versions ----
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS chunk_diff JSONB;
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0;

-- ---- knowledge_learning_queue ----
-- init-database.sql 中已有基础字段

-- ---- users ----
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ---- customers ----
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS platform_connection_id VARCHAR(36);

-- 客户表部分唯一索引
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS customers_external_id_unique_idx
    ON customers(source_platform, external_id, platform_connection_id);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'customers_external_id_unique_idx may already exist with different definition: %', SQLERRM;
END $$;

-- ---- quick_replies ----
ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS platform_connection_id VARCHAR(36);

-- =============================================================================
-- PART 2: 新建缺失的表（schema.ts 有定义但 init-database.sql 没有的表）
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 尺码配置表 - 结构化尺码表管理（与商品详情关联，支持 AI 查询与尺码推荐）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS size_charts (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT '未分类',
  parent_category VARCHAR(100),
  chart_type VARCHAR(30) NOT NULL DEFAULT 'clothing',
  size_columns JSONB NOT NULL DEFAULT '[]',
  size_rows JSONB NOT NULL DEFAULT '[]',
  product_id VARCHAR(36),
  sku VARCHAR(100),
  recommend_params JSONB,
  recommend_rules TEXT,
  description TEXT,
  image_url VARCHAR(500),
  doc_ids JSONB DEFAULT '[]',
  content_hash VARCHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  platform_connection_id VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS size_charts_category_idx ON size_charts(category);
CREATE INDEX IF NOT EXISTS size_charts_product_id_idx ON size_charts(product_id);
CREATE INDEX IF NOT EXISTS size_charts_sku_idx ON size_charts(sku);
CREATE INDEX IF NOT EXISTS size_charts_status_idx ON size_charts(status);
CREATE INDEX IF NOT EXISTS size_charts_content_hash_idx ON size_charts(content_hash);
CREATE INDEX IF NOT EXISTS size_charts_hit_count_idx ON size_charts(hit_count);
CREATE INDEX IF NOT EXISTS size_charts_platform_connection_id_idx ON size_charts(platform_connection_id);

-- ---------------------------------------------------------------------------
-- 尺码配置版本表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS size_chart_versions (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  size_chart_id VARCHAR(36) NOT NULL REFERENCES size_charts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  chart_type VARCHAR(30) NOT NULL,
  category VARCHAR(100),
  sku VARCHAR(100),
  size_columns JSONB NOT NULL DEFAULT '[]',
  size_rows JSONB NOT NULL DEFAULT '[]',
  recommend_params JSONB,
  recommend_rules TEXT,
  description TEXT,
  change_summary TEXT,
  created_by VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS scv_chart_id_idx ON size_chart_versions(size_chart_id);
CREATE INDEX IF NOT EXISTS scv_version_number_idx ON size_chart_versions(version_number);

-- ---------------------------------------------------------------------------
-- 知识引用反馈表 - 记录每次引用是否被采纳/被拒绝（检索质量反馈）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_feedback (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id VARCHAR(36) NOT NULL,
  conversation_id VARCHAR(36),
  knowledge_item_id VARCHAR(36),
  knowledge_name VARCHAR(255),
  knowledge_score DOUBLE PRECISION,
  feedback_type VARCHAR(20) NOT NULL,
  reason VARCHAR(50),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS knowledge_feedback_message_id_idx ON knowledge_feedback(message_id);
CREATE INDEX IF NOT EXISTS knowledge_feedback_item_id_idx ON knowledge_feedback(knowledge_item_id);
CREATE INDEX IF NOT EXISTS knowledge_feedback_type_idx ON knowledge_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS knowledge_feedback_created_at_idx ON knowledge_feedback(created_at);

-- ---------------------------------------------------------------------------
-- 知识缺口信号表 - 挖掘"用户问了很多但知识库没答案"的问题
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_gap_signals (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  question_hash VARCHAR(100) NOT NULL UNIQUE,
  sample_question TEXT NOT NULL,
  question_category VARCHAR(100),
  frequency INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_top_score DOUBLE PRECISION,
  triggers_handoff BOOLEAN NOT NULL DEFAULT FALSE,
  source_conversation_ids JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  resolved_by VARCHAR(36),
  resolved_at TIMESTAMPTZ,
  linked_knowledge_item_id VARCHAR(36),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_gap_status_idx ON knowledge_gap_signals(status);
CREATE INDEX IF NOT EXISTS knowledge_gap_frequency_idx ON knowledge_gap_signals(frequency);
CREATE INDEX IF NOT EXISTS knowledge_gap_last_seen_idx ON knowledge_gap_signals(last_seen_at);

-- ---------------------------------------------------------------------------
-- Agent委派记录表 - 主Bot委派任务给子Agent的记录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_delegations (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_bot_id VARCHAR(36) NOT NULL,
  child_bot_id VARCHAR(36) NOT NULL,
  trigger_intent VARCHAR(100),
  input_message TEXT,
  result_content TEXT,
  confidence DOUBLE PRECISION,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_delegations_conversation_id_idx ON agent_delegations(conversation_id);
CREATE INDEX IF NOT EXISTS agent_delegations_parent_bot_id_idx ON agent_delegations(parent_bot_id);
CREATE INDEX IF NOT EXISTS agent_delegations_child_bot_id_idx ON agent_delegations(child_bot_id);
CREATE INDEX IF NOT EXISTS agent_delegations_status_idx ON agent_delegations(status);

-- ---------------------------------------------------------------------------
-- Agent协作通信表 - 子Agent间的协作通信记录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_collaborations (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  delegation_id VARCHAR(36) REFERENCES agent_delegations(id) ON DELETE CASCADE,
  sender_bot_id VARCHAR(36) NOT NULL,
  receiver_bot_id VARCHAR(36) NOT NULL,
  message_type VARCHAR(30) NOT NULL DEFAULT 'request',
  content TEXT NOT NULL,
  context JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_collaborations_conversation_id_idx ON agent_collaborations(conversation_id);
CREATE INDEX IF NOT EXISTS agent_collaborations_delegation_id_idx ON agent_collaborations(delegation_id);
CREATE INDEX IF NOT EXISTS agent_collaborations_sender_bot_id_idx ON agent_collaborations(sender_bot_id);
CREATE INDEX IF NOT EXISTS agent_collaborations_receiver_bot_id_idx ON agent_collaborations(receiver_bot_id);

-- ---------------------------------------------------------------------------
-- 模拟测试会话表（与 migrations/004_add_simulation_tables.sql 相同，含 created_by）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS simulation_conversations (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  scenario_id VARCHAR(50),
  scenario_name VARCHAR(100) NOT NULL DEFAULT '订单查询',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(36),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS simulation_conversations_status_idx ON simulation_conversations(status);
CREATE INDEX IF NOT EXISTS simulation_conversations_created_at_idx ON simulation_conversations(created_at);
CREATE INDEX IF NOT EXISTS simulation_conversations_created_by_idx ON simulation_conversations(created_by);

-- ---------------------------------------------------------------------------
-- 模拟测试消息表（与 migrations/004_add_simulation_tables.sql 相同）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS simulation_messages (
  id VARCHAR(50) PRIMARY KEY,
  conversation_id VARCHAR(50) NOT NULL REFERENCES simulation_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  sources JSONB,
  confidence DOUBLE PRECISION,
  confidence_breakdown JSONB,
  tool_calls JSONB,
  tool_results JSONB,
  image_url TEXT,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  rich_content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS simulation_messages_conversation_id_idx ON simulation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS simulation_messages_created_at_idx ON simulation_messages(created_at);

-- ---------------------------------------------------------------------------
-- 商品详情表 - 结构化商品信息管理
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_details (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(100) DEFAULT '未分类',
  parent_category VARCHAR(100),
  brand VARCHAR(100),
  price DOUBLE PRECISION,
  original_price DOUBLE PRECISION,
  specifications JSONB DEFAULT '[]',
  features JSONB DEFAULT '[]',
  description TEXT,
  usage_instructions TEXT,
  image_urls JSONB DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'on_sale',
  doc_ids JSONB DEFAULT '[]',
  content_hash VARCHAR(64),
  tags JSONB DEFAULT '[]',
  external_product_id VARCHAR(100),
  sync_source VARCHAR(20) NOT NULL DEFAULT 'manual',
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  platform_connection_id VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS product_details_sku_idx ON product_details(sku);
CREATE INDEX IF NOT EXISTS product_details_category_idx ON product_details(category);
CREATE INDEX IF NOT EXISTS product_details_status_idx ON product_details(status);
CREATE INDEX IF NOT EXISTS product_details_content_hash_idx ON product_details(content_hash);
CREATE INDEX IF NOT EXISTS product_details_sync_source_idx ON product_details(sync_source);
CREATE INDEX IF NOT EXISTS product_details_hit_count_idx ON product_details(hit_count);
CREATE INDEX IF NOT EXISTS product_details_platform_connection_id_idx ON product_details(platform_connection_id);

-- ---------------------------------------------------------------------------
-- Webhook 事件处理记录表 - 用于 Gorgias Webhook 事件幂等性检查
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_event_processed (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  object_id VARCHAR(50),
  result VARCHAR(20) NOT NULL DEFAULT 'success',
  error_message TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_event_processed_event_id_idx ON webhook_event_processed(event_id);
CREATE INDEX IF NOT EXISTS webhook_event_processed_event_type_idx ON webhook_event_processed(event_type);
CREATE INDEX IF NOT EXISTS webhook_event_processed_processed_at_idx ON webhook_event_processed(processed_at);

-- ---------------------------------------------------------------------------
-- 敏感词表 - 用户消息敏感词过滤规则
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_sensitive_words (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  word VARCHAR(100) NOT NULL UNIQUE,
  match_mode VARCHAR(20) NOT NULL DEFAULT 'exact',
  action VARCHAR(20) NOT NULL DEFAULT 'block',
  replacement VARCHAR(100),
  category VARCHAR(50) DEFAULT '脏话',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS csw_word_idx ON content_sensitive_words(word);
CREATE INDEX IF NOT EXISTS csw_category_idx ON content_sensitive_words(category);
CREATE INDEX IF NOT EXISTS csw_is_enabled_idx ON content_sensitive_words(is_enabled);

-- ---------------------------------------------------------------------------
-- URL白名单表 - 允许发送的域名白名单
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS allowed_domains (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) NOT NULL UNIQUE,
  pattern_type VARCHAR(20) NOT NULL DEFAULT 'exact',
  description VARCHAR(255),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_domain_idx ON allowed_domains(domain);
CREATE INDEX IF NOT EXISTS ad_is_enabled_idx ON allowed_domains(is_enabled);

-- ---------------------------------------------------------------------------
-- 过滤日志表 - 记录所有内容过滤事件
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_filter_logs (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(36),
  message_id VARCHAR(36),
  filter_type VARCHAR(20) NOT NULL,
  word VARCHAR(100),
  action VARCHAR(20) NOT NULL,
  original_content TEXT NOT NULL,
  filtered_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS cfl_conversation_id_idx ON content_filter_logs(conversation_id);
CREATE INDEX IF NOT EXISTS cfl_filter_type_idx ON content_filter_logs(filter_type);
CREATE INDEX IF NOT EXISTS cfl_created_at_idx ON content_filter_logs(created_at);

-- ---------------------------------------------------------------------------
-- 坐席分配配置表（来自 migrations/20260626_agent_assignment.sql）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_assignment_config (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  condition_config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_assignment_config_strategy ON agent_assignment_config(strategy);
CREATE INDEX IF NOT EXISTS idx_agent_assignment_config_is_enabled ON agent_assignment_config(is_enabled);

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

CREATE INDEX IF NOT EXISTS idx_agent_assignment_stats_user_date ON agent_assignment_stats(user_id, date);
CREATE INDEX IF NOT EXISTS idx_agent_assignment_stats_active_conversations ON agent_assignment_stats(active_conversations);

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

-- ---------------------------------------------------------------------------
-- 登录日志表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_events (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  event_type VARCHAR(20) NOT NULL,
  ip_address VARCHAR(50),
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS login_events_user_id_idx ON login_events(user_id);
CREATE INDEX IF NOT EXISTS login_events_created_at_idx ON login_events(created_at);
CREATE INDEX IF NOT EXISTS login_events_email_idx ON login_events(email);
CREATE INDEX IF NOT EXISTS login_events_event_type_idx ON login_events(event_type);

-- ---------------------------------------------------------------------------
-- 知识库导入任务表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_import_jobs (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(20) NOT NULL,
  file_size INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  stage VARCHAR(30),
  progress INTEGER DEFAULT 0,
  description TEXT,
  chunks_preview JSONB,
  total_chunks INTEGER,
  processed_chunks INTEGER DEFAULT 0,
  doc_ids JSONB DEFAULT '[]',
  error_message TEXT,
  created_by VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kij_status_idx ON knowledge_import_jobs(status);
CREATE INDEX IF NOT EXISTS kij_created_at_idx ON knowledge_import_jobs(created_at);
CREATE INDEX IF NOT EXISTS kij_created_by_idx ON knowledge_import_jobs(created_by);

-- ---------------------------------------------------------------------------
-- Bot 配置表扩展字段（init-database.sql 已创建基础表，补全缺失列）
-- ---------------------------------------------------------------------------
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS parent_bot_id VARCHAR(36);
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS delegation_prompt TEXT;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS collaboration_config JSONB DEFAULT '{}';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS is_sub_agent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS bot_configs_parent_bot_id_idx ON bot_configs(parent_bot_id);
CREATE INDEX IF NOT EXISTS bot_configs_is_sub_agent_idx ON bot_configs(is_sub_agent);

-- ---------------------------------------------------------------------------
-- 店铺表扩展字段（init-database.sql 已创建基础表，补全缺失列）
-- ---------------------------------------------------------------------------
ALTER TABLE shops ADD COLUMN IF NOT EXISTS shop_url VARCHAR(500);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS total_accounts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS used_accounts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS contact_name VARCHAR(100);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS knowledge_ids JSONB DEFAULT '[]';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS agent_quota INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 店铺托管客服账号表（init-database.sql 未创建）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_agent_accounts (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id VARCHAR(36) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  account_name VARCHAR(255) NOT NULL,
  encrypted_password TEXT NOT NULL,
  platform VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS shop_agent_accounts_shop_id_idx ON shop_agent_accounts(shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS shop_agent_accounts_shop_account_idx ON shop_agent_accounts(shop_id, account_name);

-- ---------------------------------------------------------------------------
-- conversations 表扩展字段
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS participant_ids JSONB;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_collaborative BOOLEAN DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- messages 表扩展字段
-- ---------------------------------------------------------------------------
-- metadata 列在 PART 1 已添加

-- ---------------------------------------------------------------------------
-- marketing_campaigns 表索引（init-database.sql 有表但缺少 trigger 相关索引）
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS marketing_campaigns_trigger_type_idx ON marketing_campaigns(trigger_type);
CREATE INDEX IF NOT EXISTS marketing_campaigns_scheduled_at_idx ON marketing_campaigns(scheduled_at);

-- ---------------------------------------------------------------------------
-- messages.role 索引（init-database.sql 缺少）
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS messages_role_idx ON messages(role);

-- ---------------------------------------------------------------------------
-- conversations 复合索引
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS conversations_status_created_idx ON conversations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS conversations_is_collaborative_idx ON conversations(is_collaborative);

-- ---------------------------------------------------------------------------
-- shop_agent_accounts.status 索引
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS shop_agent_accounts_status_idx ON shop_agent_accounts(status);

-- ---------------------------------------------------------------------------
-- Gorgias 相关索引（GIN 索引，用于 metadata 中特定 key 的查询）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS conversations_metadata_gorgias_idx
    ON conversations USING GIN (metadata)
    WHERE metadata IS NOT NULL AND metadata ? 'gorgias_ticket_id';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Index conversations_metadata_gorgias_idx may already exist: %', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS messages_metadata_gorgias_idx
    ON messages USING GIN (metadata)
    WHERE metadata IS NOT NULL AND metadata ? 'gorgias_message_id';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Index messages_metadata_gorgias_idx may already exist: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- conversations.gorgias_ticket_id 唯一索引（防止同一工单创建重复对话）
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS conversations_gorgias_ticket_id_unique
  ON conversations((metadata->>'gorgias_ticket_id'))
  WHERE metadata IS NOT NULL AND metadata ? 'gorgias_ticket_id' AND metadata->>'gorgias_ticket_id' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RPC 函数：批量增加消息计数
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_message_count_by(conv_id VARCHAR(36), delta INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE conversations
  SET message_count = message_count + delta,
      updated_at = NOW()
  WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- RPC 函数：增加模拟会话消息计数
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_simulation_message_count(conv_id VARCHAR(50))
RETURNS VOID AS $$
BEGIN
  UPDATE simulation_conversations
  SET message_count = message_count + 1,
      updated_at = NOW()
  WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- RPC 函数：尝试获取 Webhook 事件幂等锁（原子插入）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION try_acquire_webhook_event(
  p_event_id VARCHAR(100),
  p_event_type VARCHAR(50),
  p_object_id VARCHAR(50)
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO webhook_event_processed (event_id, event_type, object_id, result)
  VALUES (p_event_id, p_event_type, p_object_id, 'success')
  ON CONFLICT (event_id) DO NOTHING;
  RETURN (SELECT COUNT(*) = 0 FROM webhook_event_processed WHERE event_id = p_event_id);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PART 3: 修复现有数据
-- =============================================================================

-- 修复 conversations.gorgias_ticket_id 存储为 number 导致科学计数法的问题
UPDATE conversations
SET metadata = jsonb_set(metadata, '{gorgias_ticket_id}', to_jsonb(CAST(metadata->>'gorgias_ticket_id' AS VARCHAR(50))))
WHERE metadata IS NOT NULL
  AND metadata ? 'gorgias_ticket_id'
  AND metadata->>'gorgias_ticket_id' ~ '^[0-9]+$';

-- 修复 messages.gorgias_message_id 同理
UPDATE messages
SET metadata = jsonb_set(metadata, '{gorgias_message_id}', to_jsonb(CAST(metadata->>'gorgias_message_id' AS VARCHAR(50))))
WHERE metadata IS NOT NULL
  AND metadata ? 'gorgias_message_id'
  AND metadata->>'gorgias_message_id' ~ '^[0-9]+$';

-- 清理 knowledge_gap_signals.question_hash 列宽问题（如果有数据已超出 varchar(64)）
-- 由于该列已改为 VARCHAR(100)，无需清理

-- =============================================================================
-- PART 4: 初始化默认数据（补充 init-database.sql 未覆盖的部分）
-- =============================================================================

-- 插入默认敏感词分类标签
INSERT INTO customer_tags (id, name, color, category, is_system, customer_count) VALUES
  ('00000000-0000-0000-0000-000000000010', 'VIP客户', '#FFD700', 'manual', true, 0),
  ('00000000-0000-0000-0000-000000000011', '高价值', '#FF6B6B', 'manual', true, 0),
  ('00000000-0000-0000-0000-000000000012', '新客户', '#10B981', 'auto', true, 0),
  ('00000000-0000-0000-0000-000000000013', '活跃客户', '#3B82F6', 'auto', true, 0)
ON CONFLICT (name) DO NOTHING;

-- 插入默认 Bot 配置（主客服 Bot）
INSERT INTO bot_configs (id, name, description, system_prompt, is_default, status) VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'SmartAssist 智能客服',
    '默认智能客服 Bot，处理售前咨询、订单查询、物流跟踪、售后服务等常见问题',
    '你是 SmartAssist 智能客服助手。你需要：\n1. 礼貌、专业的回复\n2. 准确回答用户问题\n3. 遇到无法回答的问题时，引导转人工\n4. 积极主动地提供帮助',
    true,
    'active'
  )
ON CONFLICT (name) DO NOTHING;

-- 插入默认质检规则
INSERT INTO quality_rules (id, name, type, config, is_enabled) VALUES
  ('00000000-0000-0000-0000-000000000001', '负面情绪检测', 'negative_sentiment', '{"threshold": 0.6}', true),
  ('00000000-0000-0000-0000-000000000002', '关键词违规检测', 'keyword_violation', '{"keywords": ["垃圾", "骗子", "退款"]}', true)
ON CONFLICT DO NOTHING;

COMMIT;

-- =============================================================================
-- 验证：列出所有已创建的表
-- =============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

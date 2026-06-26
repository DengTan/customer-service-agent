-- SmartAssist 数据库初始化脚本
-- 执行方式: 在 Supabase Dashboard > SQL Editor 中运行，或使用 psql

-- 启用 UUID 生成
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════
-- Phase 0: 核心表
-- ═══════════════════════════════════════════════════════════════

-- Bot配置表 - 多Bot路由
CREATE TABLE IF NOT EXISTS bot_configs (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE,
  description text,
  system_prompt text NOT NULL,
  tools jsonb NOT NULL DEFAULT '[]',
  knowledge_ids jsonb NOT NULL DEFAULT '[]',
  skill_group_id varchar(36),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS bot_configs_is_default_idx ON bot_configs(is_default);

-- 路由规则表
CREATE TABLE IF NOT EXISTS routing_rules (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  condition_type varchar(30) NOT NULL DEFAULT 'keyword',
  condition_config jsonb NOT NULL DEFAULT '{}',
  target_bot_id varchar(36) NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS routing_rules_condition_type_idx ON routing_rules(condition_type);
CREATE INDEX IF NOT EXISTS routing_rules_is_enabled_idx ON routing_rules(is_enabled);

-- 营销活动表
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  type varchar(30) NOT NULL DEFAULT 'abandoned_cart',
  target_segment jsonb NOT NULL DEFAULT '{}',
  bot_id varchar(36) REFERENCES bot_configs(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  ab_variants jsonb,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS marketing_campaigns_status_idx ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS marketing_campaigns_type_idx ON marketing_campaigns(type);

-- 营销日志表
CREATE TABLE IF NOT EXISTS marketing_logs (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id varchar(36) NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  customer_id varchar(36) REFERENCES customers(id) ON DELETE SET NULL,
  conversation_id varchar(36) REFERENCES conversations(id) ON DELETE SET NULL,
  variant varchar(10),
  sent_at timestamptz DEFAULT NOW() NOT NULL,
  opened boolean NOT NULL DEFAULT false,
  replied boolean NOT NULL DEFAULT false,
  converted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS marketing_logs_campaign_id_idx ON marketing_logs(campaign_id);
CREATE INDEX IF NOT EXISTS marketing_logs_customer_id_idx ON marketing_logs(customer_id);

-- 对话表
CREATE TABLE IF NOT EXISTS conversations (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(255) NOT NULL DEFAULT '新对话',
  status varchar(20) NOT NULL DEFAULT 'active',
  rating integer,
  rating_comment text,
  message_count integer NOT NULL DEFAULT 0,
  source varchar(20) NOT NULL DEFAULT 'web',
  priority varchar(20) NOT NULL DEFAULT 'normal',
  unread_count integer NOT NULL DEFAULT 0,
  platform_connection_id varchar(36),
  external_user_id varchar(255),
  external_session_id varchar(255),
  handoff_reason text,
  assigned_agent varchar(100),
  summary text,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS conversations_status_idx ON conversations(status);
CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON conversations(created_at);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL,
  content text NOT NULL,
  sources jsonb,
  confidence double precision,
  confidence_breakdown jsonb,
  tool_calls jsonb,
  tool_results jsonb,
  image_url text,
  message_type varchar(20) NOT NULL DEFAULT 'text',
  rich_content jsonb,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);

-- 自动回复规则表
CREATE TABLE IF NOT EXISTS auto_reply_rules (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword varchar(255) NOT NULL,
  match_mode varchar(20) NOT NULL DEFAULT 'fuzzy',
  reply_content text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS auto_reply_rules_enabled_idx ON auto_reply_rules(is_enabled);

-- 平台连接表
CREATE TABLE IF NOT EXISTS platform_connections (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  platform varchar(50) NOT NULL,
  app_key varchar(100) NOT NULL,
  app_secret varchar(200) NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  shop_name varchar(255),
  shop_id varchar(100),
  status varchar(20) NOT NULL DEFAULT 'disconnected',
  webhook_url text,
  config jsonb,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS platform_connections_platform_idx ON platform_connections(platform);
CREATE INDEX IF NOT EXISTS platform_connections_status_idx ON platform_connections(status);

-- 知识库条目表
CREATE TABLE IF NOT EXISTS knowledge_items (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  type varchar(20) NOT NULL DEFAULT 'text',
  content text,
  doc_ids jsonb,
  category varchar(100) DEFAULT '未分类',
  status varchar(20) NOT NULL DEFAULT 'active',
  chunk_count integer DEFAULT 0,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS knowledge_items_status_idx ON knowledge_items(status);
CREATE INDEX IF NOT EXISTS knowledge_items_category_idx ON knowledge_items(category);

-- 知识自学习队列表
CREATE TABLE IF NOT EXISTS knowledge_learning_queue (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  confidence double precision NOT NULL DEFAULT 0,
  conversation_id varchar(36) REFERENCES conversations(id) ON DELETE SET NULL,
  conversation_title varchar(255),
  source_context text,
  category varchar(100) DEFAULT '未分类',
  status varchar(20) NOT NULL DEFAULT 'pending',
  reviewed_by varchar(100),
  reviewed_at timestamptz,
  knowledge_item_id varchar(36),
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS klq_status_idx ON knowledge_learning_queue(status);
CREATE INDEX IF NOT EXISTS klq_confidence_idx ON knowledge_learning_queue(confidence);
CREATE INDEX IF NOT EXISTS klq_created_at_idx ON knowledge_learning_queue(created_at);
CREATE INDEX IF NOT EXISTS klq_conversation_id_idx ON knowledge_learning_queue(conversation_id);

-- 告警表
CREATE TABLE IF NOT EXISTS alerts (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar(36) REFERENCES conversations(id) ON DELETE CASCADE,
  type varchar(50) NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  is_resolved boolean NOT NULL DEFAULT false,
  metadata jsonb,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS alerts_conversation_id_idx ON alerts(conversation_id);
CREATE INDEX IF NOT EXISTS alerts_is_resolved_idx ON alerts(is_resolved);
CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON alerts(created_at);

-- 系统设置表
CREATE TABLE IF NOT EXISTS settings (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(100) NOT NULL UNIQUE,
  value text NOT NULL,
  updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settings_key_idx ON settings(key);

-- ═══════════════════════════════════════════════════════════════
-- Phase 1: RBAC + 客户画像
-- ═══════════════════════════════════════════════════════════════

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  avatar text,
  role varchar(20) NOT NULL DEFAULT 'agent',
  status varchar(20) NOT NULL DEFAULT 'active',
  last_active_at timestamptz,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);

-- 角色权限表
CREATE TABLE IF NOT EXISTS role_permissions (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  role varchar(20) NOT NULL,
  resource varchar(50) NOT NULL,
  action varchar(20) NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions(role);
CREATE INDEX IF NOT EXISTS role_permissions_resource_idx ON role_permissions(resource);

-- 客户表
CREATE TABLE IF NOT EXISTS customers (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  phone varchar(20),
  email varchar(255),
  avatar text,
  source_platform varchar(20) NOT NULL DEFAULT 'web',
  external_id varchar(255),
  tags jsonb NOT NULL DEFAULT '[]',
  metadata jsonb,
  notes text,
  conversation_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz DEFAULT NOW() NOT NULL,
  last_seen_at timestamptz DEFAULT NOW() NOT NULL,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS customers_source_platform_idx ON customers(source_platform);
CREATE INDEX IF NOT EXISTS customers_external_id_idx ON customers(external_id);
CREATE INDEX IF NOT EXISTS customers_last_seen_at_idx ON customers(last_seen_at);

-- 客户标签表
CREATE TABLE IF NOT EXISTS customer_tags (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL UNIQUE,
  color varchar(20) NOT NULL DEFAULT '#2F6BFF',
  category varchar(20) NOT NULL DEFAULT 'manual',
  is_system boolean NOT NULL DEFAULT false,
  customer_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS customer_tags_category_idx ON customer_tags(category);

-- 客户对话关联表
CREATE TABLE IF NOT EXISTS customer_conversations (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id varchar(36) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  conversation_id varchar(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS customer_conversations_customer_id_idx ON customer_conversations(customer_id);
CREATE INDEX IF NOT EXISTS customer_conversations_conversation_id_idx ON customer_conversations(conversation_id);

-- ═══════════════════════════════════════════════════════════════
-- Phase 2: 坐席工作台
-- ═══════════════════════════════════════════════════════════════

-- 坐席会话表
CREATE TABLE IF NOT EXISTS agent_sessions (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'offline',
  current_conversation_id varchar(36),
  last_active_at timestamptz DEFAULT NOW() NOT NULL,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_sessions_user_id_idx ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS agent_sessions_status_idx ON agent_sessions(status);

-- 坐席排队表
CREATE TABLE IF NOT EXISTS agent_queue (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_name varchar(100),
  priority varchar(20) NOT NULL DEFAULT 'normal',
  skill_group_id varchar(36),
  assigned_agent_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',
  reason text,
  summary text,
  source_platform varchar(20),
  created_at timestamptz DEFAULT NOW() NOT NULL,
  assigned_at timestamptz,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_queue_status_idx ON agent_queue(status);
CREATE INDEX IF NOT EXISTS agent_queue_assigned_agent_id_idx ON agent_queue(assigned_agent_id);
CREATE INDEX IF NOT EXISTS agent_queue_created_at_idx ON agent_queue(created_at);

-- 技能组表
CREATE TABLE IF NOT EXISTS skill_groups (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL UNIQUE,
  description text,
  member_ids jsonb NOT NULL DEFAULT '[]',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

-- 快捷回复话术库表
CREATE TABLE IF NOT EXISTS quick_replies (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(100) NOT NULL,
  content text NOT NULL,
  category varchar(50) NOT NULL DEFAULT '通用',
  variables jsonb NOT NULL DEFAULT '[]',
  scope varchar(20) NOT NULL DEFAULT 'global',
  creator_id varchar(36),
  usage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS quick_replies_category_idx ON quick_replies(category);
CREATE INDEX IF NOT EXISTS quick_replies_scope_idx ON quick_replies(scope);

-- 对话标签定义表
CREATE TABLE IF NOT EXISTS conversation_tags_def (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL UNIQUE,
  color varchar(20) NOT NULL DEFAULT '#2F6BFF',
  category varchar(20) NOT NULL DEFAULT 'question_type',
  conversation_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS conversation_tags_def_category_idx ON conversation_tags_def(category);

-- 对话标签记录表
CREATE TABLE IF NOT EXISTS conversation_tag_records (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id varchar(36) NOT NULL REFERENCES conversation_tags_def(id) ON DELETE CASCADE,
  tagged_by varchar(36),
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS conversation_tag_records_conversation_id_idx ON conversation_tag_records(conversation_id);
CREATE INDEX IF NOT EXISTS conversation_tag_records_tag_id_idx ON conversation_tag_records(tag_id);

-- 质检规则表
CREATE TABLE IF NOT EXISTS quality_rules (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  type varchar(30) NOT NULL DEFAULT 'first_response_timeout',
  config jsonb NOT NULL DEFAULT '{}',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

-- 质检记录表
CREATE TABLE IF NOT EXISTS quality_checks (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  rule_id varchar(36) NOT NULL REFERENCES quality_rules(id) ON DELETE CASCADE,
  result varchar(10) NOT NULL DEFAULT 'pass',
  detail text,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS quality_checks_conversation_id_idx ON quality_checks(conversation_id);
CREATE INDEX IF NOT EXISTS quality_checks_rule_id_idx ON quality_checks(rule_id);
CREATE INDEX IF NOT EXISTS quality_checks_result_idx ON quality_checks(result);

-- 排班表
CREATE TABLE IF NOT EXISTS schedules (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_group_id varchar(36) NOT NULL REFERENCES skill_groups(id) ON DELETE CASCADE,
  date varchar(10) NOT NULL,
  shift varchar(20) NOT NULL DEFAULT 'morning',
  status varchar(20) NOT NULL DEFAULT 'scheduled',
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS schedules_user_id_idx ON schedules(user_id);
CREATE INDEX IF NOT EXISTS schedules_date_idx ON schedules(date);

-- 知识库版本表
CREATE TABLE IF NOT EXISTS knowledge_versions (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_item_id varchar(36) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  title varchar(200) NOT NULL,
  content text NOT NULL,
  category varchar(50),
  change_summary text,
  created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS knowledge_versions_item_id_idx ON knowledge_versions(knowledge_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_versions_item_version_idx ON knowledge_versions(knowledge_item_id, version);

-- ═══════════════════════════════════════════════════════════════
-- Phase 3: 推送相关
-- ═══════════════════════════════════════════════════════════════

-- 推送模板表
CREATE TABLE IF NOT EXISTS push_templates (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  trigger_event varchar(50) NOT NULL,
  content_template text NOT NULL,
  channels jsonb NOT NULL DEFAULT '["web"]',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_templates_trigger_event_idx ON push_templates(trigger_event);
CREATE INDEX IF NOT EXISTS push_templates_is_enabled_idx ON push_templates(is_enabled);

-- 推送记录表
CREATE TABLE IF NOT EXISTS push_records (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id varchar(36) REFERENCES push_templates(id) ON DELETE SET NULL,
  recipient varchar(255) NOT NULL,
  content text NOT NULL,
  trigger_event varchar(50) NOT NULL,
  channel varchar(20) NOT NULL DEFAULT 'web',
  status varchar(20) NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS push_records_template_id_idx ON push_records(template_id);
CREATE INDEX IF NOT EXISTS push_records_status_idx ON push_records(status);
CREATE INDEX IF NOT EXISTS push_records_created_at_idx ON push_records(created_at);

-- 推送事件日志表
CREATE TABLE IF NOT EXISTS push_event_log (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(50) NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}',
  status varchar(20) NOT NULL DEFAULT 'received',
  error_message text,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS push_event_log_event_type_idx ON push_event_log(event_type);
CREATE INDEX IF NOT EXISTS push_event_log_status_idx ON push_event_log(status);
CREATE INDEX IF NOT EXISTS push_event_log_created_at_idx ON push_event_log(created_at);

-- ═══════════════════════════════════════════════════════════════
-- Phase 4: 工单系统
-- ═══════════════════════════════════════════════════════════════

-- 工单表
CREATE TABLE IF NOT EXISTS tickets (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number varchar(50) NOT NULL UNIQUE,
  title varchar(255) NOT NULL,
  description text,
  category varchar(50) DEFAULT '其他',
  priority varchar(20) NOT NULL DEFAULT 'normal',
  status varchar(20) NOT NULL DEFAULT 'open',
  assignee_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  creator_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  related_conversation_id varchar(36) REFERENCES conversations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT NOW() NOT NULL,
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_priority_idx ON tickets(priority);
CREATE INDEX IF NOT EXISTS tickets_assignee_id_idx ON tickets(assignee_id);

-- 工单评论表
CREATE TABLE IF NOT EXISTS ticket_comments (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id varchar(36) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  content text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS ticket_comments_ticket_id_idx ON ticket_comments(ticket_id);

-- 工单状态变更日志表
CREATE TABLE IF NOT EXISTS ticket_status_log (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id varchar(36) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  operator_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS ticket_status_log_ticket_id_idx ON ticket_status_log(ticket_id);

-- 健康检查表
CREATE TABLE IF NOT EXISTS health_check (
  id serial PRIMARY KEY,
  updated_at timestamptz DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 初始化默认数据
-- ═══════════════════════════════════════════════════════════════

-- 插入默认管理员用户 (密码需要单独设置)
INSERT INTO users (id, email, name, role, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@smartassist.com', '系统管理员', 'admin', 'active')
ON CONFLICT (email) DO NOTHING;

-- 插入默认技能组
INSERT INTO skill_groups (id, name, description, is_default) VALUES
  ('00000000-0000-0000-0000-000000000001', '默认组', '默认客服技能组', true)
ON CONFLICT (name) DO NOTHING;

-- 插入默认对话标签
INSERT INTO conversation_tags_def (id, name, color, category) VALUES
  ('00000000-0000-0000-0000-000000000001', '产品咨询', '#2F6BFF', 'question_type'),
  ('00000000-0000-0000-0000-000000000002', '售后问题', '#F59E0B', 'question_type'),
  ('00000000-0000-0000-0000-000000000003', '投诉', '#EF4444', 'sentiment'),
  ('00000000-0000-0000-0000-000000000004', '正面', '#10B981', 'sentiment')
ON CONFLICT (name) DO NOTHING;

-- 初始化 health_check
INSERT INTO health_check (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 生成 webhook 密钥（如果还没有的话）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE key = 'webhook_secret') THEN
    INSERT INTO settings (key, value) VALUES ('webhook_secret', gen_random_uuid()::text);
  END IF;
END $$;

RAISE NOTICE 'SmartAssist 数据库初始化完成！';

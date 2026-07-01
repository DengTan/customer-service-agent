-- =============================================================================
-- SmartAssist 数据库完整迁移脚本
-- 执行时间: 2026-06-27
-- 描述: 完整数据库初始化 + 补全所有缺失的表和字段
--
-- 前置条件: 
--   1. 如果是全新数据库: 直接执行此脚本
--   2. 如果已有基础表: 需先执行 init-database.sql，再执行此脚本
--
-- 执行方式:
--   方式1: Supabase Dashboard > SQL Editor > 粘贴执行
--   方式2: psql 命令行: psql $DATABASE_URL -f <此文件>
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 0: 检查并创建基础表（如果不存在）
-- =============================================================================

-- 检查是否已有基础表
DO $$
DECLARE
  base_table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO base_table_count 
  FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_name = 'users';
  
  IF base_table_count = 0 THEN
    RAISE NOTICE 'Creating base tables from init-database.sql schema...';
    
    -- Phase 0: 核心表
    CREATE TABLE IF NOT EXISTS bot_configs (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(100) NOT NULL UNIQUE,
      description text,
      system_prompt text NOT NULL,
      tools jsonb NOT NULL DEFAULT '[]',
      knowledge_ids jsonb NOT NULL DEFAULT '[]',
      skill_group_id varchar(36),
      is_default boolean NOT NULL DEFAULT false,
      parent_bot_id varchar(36),
      delegation_prompt text,
      collaboration_config jsonb DEFAULT '{}',
      is_sub_agent boolean NOT NULL DEFAULT false,
      status varchar(20) NOT NULL DEFAULT 'active',
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS bot_configs_is_default_idx ON bot_configs(is_default);
    CREATE INDEX IF NOT EXISTS bot_configs_parent_bot_id_idx ON bot_configs(parent_bot_id);
    CREATE INDEX IF NOT EXISTS bot_configs_is_sub_agent_idx ON bot_configs(is_sub_agent);
    
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
    
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(100) NOT NULL,
      type varchar(30) NOT NULL DEFAULT 'abandoned_cart',
      target_segment jsonb NOT NULL DEFAULT '{}',
      bot_id varchar(36) REFERENCES bot_configs(id) ON DELETE SET NULL,
      status varchar(20) NOT NULL DEFAULT 'draft',
      ab_variants jsonb,
      message_template text,
      trigger_type varchar(20) DEFAULT 'manual',
      scheduled_at timestamptz,
      trigger_config jsonb,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS marketing_campaigns_status_idx ON marketing_campaigns(status);
    CREATE INDEX IF NOT EXISTS marketing_campaigns_type_idx ON marketing_campaigns(type);
    CREATE INDEX IF NOT EXISTS marketing_campaigns_trigger_type_idx ON marketing_campaigns(trigger_type);
    CREATE INDEX IF NOT EXISTS marketing_campaigns_scheduled_at_idx ON marketing_campaigns(scheduled_at);
    
    CREATE TABLE IF NOT EXISTS marketing_logs (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id varchar(36) NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
      customer_id varchar(36),
      conversation_id varchar(36),
      variant varchar(10),
      sent_at timestamptz DEFAULT NOW() NOT NULL,
      opened boolean NOT NULL DEFAULT false,
      replied boolean NOT NULL DEFAULT false,
      converted boolean NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS marketing_logs_campaign_id_idx ON marketing_logs(campaign_id);
    CREATE INDEX IF NOT EXISTS marketing_logs_customer_id_idx ON marketing_logs(customer_id);
    
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
      participant_ids jsonb,
      is_collaborative boolean DEFAULT FALSE,
      metadata jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS conversations_status_idx ON conversations(status);
    CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON conversations(created_at);
    CREATE INDEX IF NOT EXISTS conversations_status_created_idx ON conversations(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS conversations_is_collaborative_idx ON conversations(is_collaborative);
    
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
      metadata jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);
    CREATE INDEX IF NOT EXISTS messages_role_idx ON messages(role);
    
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
    
    CREATE TABLE IF NOT EXISTS knowledge_items (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL,
      type varchar(20) NOT NULL DEFAULT 'text',
      content text,
      doc_ids jsonb,
      category varchar(100) DEFAULT '未分类',
      parent_category varchar(100),
      status varchar(20) NOT NULL DEFAULT 'active',
      chunk_count integer DEFAULT 0,
      content_hash varchar(64),
      hit_count integer DEFAULT 0,
      last_hit_at timestamptz,
      adopted_count integer DEFAULT 0,
      rejected_count integer DEFAULT 0,
      archived_at timestamptz,
      expires_at timestamptz,
      image_url text,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS knowledge_items_status_idx ON knowledge_items(status);
    CREATE INDEX IF NOT EXISTS knowledge_items_category_idx ON knowledge_items(category);
    CREATE INDEX IF NOT EXISTS knowledge_items_content_hash_idx ON knowledge_items(content_hash);
    CREATE INDEX IF NOT EXISTS knowledge_items_archived_at_idx ON knowledge_items(archived_at);
    CREATE INDEX IF NOT EXISTS knowledge_items_expires_at_idx ON knowledge_items(expires_at);
    
    CREATE TABLE IF NOT EXISTS knowledge_learning_queue (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      question text NOT NULL,
      answer text NOT NULL,
      confidence double precision NOT NULL DEFAULT 0,
      conversation_id varchar(36),
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
    
    CREATE TABLE IF NOT EXISTS settings (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      key varchar(100) NOT NULL UNIQUE,
      value text NOT NULL,
      updated_at timestamptz DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS settings_key_idx ON settings(key);
    
    -- Phase 1: RBAC + 客户画像
    CREATE TABLE IF NOT EXISTS users (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      email varchar(255) NOT NULL UNIQUE,
      name varchar(100) NOT NULL,
      avatar text,
      role varchar(20) NOT NULL DEFAULT 'agent',
      status varchar(20) NOT NULL DEFAULT 'active',
      password_hash text,
      last_active_at timestamptz,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
    CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
    CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
    
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
      is_anonymous boolean DEFAULT FALSE,
      platform_connection_id varchar(36),
      first_seen_at timestamptz DEFAULT NOW() NOT NULL,
      last_seen_at timestamptz DEFAULT NOW() NOT NULL,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS customers_source_platform_idx ON customers(source_platform);
    CREATE INDEX IF NOT EXISTS customers_external_id_idx ON customers(external_id);
    CREATE INDEX IF NOT EXISTS customers_last_seen_at_idx ON customers(last_seen_at);
    CREATE INDEX IF NOT EXISTS customers_platform_connection_id_idx ON customers(platform_connection_id);
    
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
    
    CREATE TABLE IF NOT EXISTS customer_conversations (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id varchar(36) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      conversation_id varchar(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      created_at timestamptz DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_conversations_customer_id_idx ON customer_conversations(customer_id);
    CREATE INDEX IF NOT EXISTS customer_conversations_conversation_id_idx ON customer_conversations(conversation_id);
    
    -- Phase 2: 坐席工作台
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
    
    CREATE TABLE IF NOT EXISTS skill_groups (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(50) NOT NULL UNIQUE,
      description text,
      member_ids jsonb NOT NULL DEFAULT '[]',
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    
    CREATE TABLE IF NOT EXISTS quick_replies (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      title varchar(100) NOT NULL,
      content text NOT NULL,
      category varchar(50) NOT NULL DEFAULT '通用',
      variables jsonb NOT NULL DEFAULT '[]',
      scope varchar(20) NOT NULL DEFAULT 'global',
      creator_id varchar(36),
      platform_connection_id varchar(36),
      usage_count integer NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS quick_replies_category_idx ON quick_replies(category);
    CREATE INDEX IF NOT EXISTS quick_replies_scope_idx ON quick_replies(scope);
    
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
    
    CREATE TABLE IF NOT EXISTS conversation_tag_records (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id varchar(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tag_id varchar(36) NOT NULL REFERENCES conversation_tags_def(id) ON DELETE CASCADE,
      tagged_by varchar(36),
      created_at timestamptz DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_tag_records_conversation_id_idx ON conversation_tag_records(conversation_id);
    CREATE INDEX IF NOT EXISTS conversation_tag_records_tag_id_idx ON conversation_tag_records(tag_id);
    
    CREATE TABLE IF NOT EXISTS quality_rules (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(100) NOT NULL,
      type varchar(30) NOT NULL DEFAULT 'first_response_timeout',
      config jsonb NOT NULL DEFAULT '{}',
      is_enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    
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
    
    CREATE TABLE IF NOT EXISTS knowledge_versions (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      knowledge_item_id varchar(36) NOT NULL,
      version integer NOT NULL DEFAULT 1,
      title varchar(200) NOT NULL,
      content text NOT NULL,
      category varchar(50),
      change_summary text,
      chunk_diff jsonb,
      chunk_count integer DEFAULT 0,
      created_by varchar(36) REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_versions_item_id_idx ON knowledge_versions(knowledge_item_id);
    
    -- Phase 3: 推送相关
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
    
    -- Phase 4: 工单系统
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
    
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id varchar(36) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
      content text NOT NULL,
      is_internal boolean NOT NULL DEFAULT false,
      created_at timestamptz DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_comments_ticket_id_idx ON ticket_comments(ticket_id);
    
    CREATE TABLE IF NOT EXISTS ticket_status_log (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id varchar(36) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      from_status varchar(20),
      to_status varchar(20) NOT NULL,
      operator_id varchar(36) REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_status_log_ticket_id_idx ON ticket_status_log(ticket_id);
    
    CREATE TABLE IF NOT EXISTS health_check (
      id serial PRIMARY KEY,
      updated_at timestamptz DEFAULT NOW()
    );
    
    RAISE NOTICE 'Base tables created successfully.';
  ELSE
    RAISE NOTICE 'Base tables already exist, skipping creation.';
  END IF;
END $$;

-- =============================================================================
-- PART 1: 补全基础表缺失的字段
-- =============================================================================

-- shops 表（可能需要先创建）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shops') THEN
    CREATE TABLE IF NOT EXISTS shops (
      id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL,
      platform varchar(50) NOT NULL DEFAULT 'qianniu',
      shop_url varchar(500),
      logo_url varchar(500),
      total_accounts integer NOT NULL DEFAULT 0,
      used_accounts integer NOT NULL DEFAULT 0,
      status varchar(20) NOT NULL DEFAULT 'active',
      contact_name varchar(100),
      contact_phone varchar(20),
      remark text,
      knowledge_ids jsonb DEFAULT '[]',
      config jsonb DEFAULT '{}',
      agent_quota integer NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS shops_platform_idx ON shops(platform);
    CREATE INDEX IF NOT EXISTS shops_status_idx ON shops(status);
  END IF;
END $$;

-- 补充 shops 表缺失的字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'shop_url') THEN
    ALTER TABLE shops ADD COLUMN shop_url varchar(500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'logo_url') THEN
    ALTER TABLE shops ADD COLUMN logo_url varchar(500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'total_accounts') THEN
    ALTER TABLE shops ADD COLUMN total_accounts integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'used_accounts') THEN
    ALTER TABLE shops ADD COLUMN used_accounts integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'contact_name') THEN
    ALTER TABLE shops ADD COLUMN contact_name varchar(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'contact_phone') THEN
    ALTER TABLE shops ADD COLUMN contact_phone varchar(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'remark') THEN
    ALTER TABLE shops ADD COLUMN remark text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'knowledge_ids') THEN
    ALTER TABLE shops ADD COLUMN knowledge_ids jsonb DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'config') THEN
    ALTER TABLE shops ADD COLUMN config jsonb DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'agent_quota') THEN
    ALTER TABLE shops ADD COLUMN agent_quota integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- conversations 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'metadata') THEN
    ALTER TABLE conversations ADD COLUMN metadata jsonb DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'participant_ids') THEN
    ALTER TABLE conversations ADD COLUMN participant_ids jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'is_collaborative') THEN
    ALTER TABLE conversations ADD COLUMN is_collaborative boolean DEFAULT FALSE;
  END IF;
END $$;

-- messages 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'metadata') THEN
    ALTER TABLE messages ADD COLUMN metadata jsonb DEFAULT '{}';
  END IF;
END $$;

-- marketing_campaigns 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_campaigns' AND column_name = 'message_template') THEN
    ALTER TABLE marketing_campaigns ADD COLUMN message_template text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_campaigns' AND column_name = 'trigger_type') THEN
    ALTER TABLE marketing_campaigns ADD COLUMN trigger_type varchar(20) DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_campaigns' AND column_name = 'scheduled_at') THEN
    ALTER TABLE marketing_campaigns ADD COLUMN scheduled_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_campaigns' AND column_name = 'trigger_config') THEN
    ALTER TABLE marketing_campaigns ADD COLUMN trigger_config jsonb;
  END IF;
END $$;

-- knowledge_items 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'content_hash') THEN
    ALTER TABLE knowledge_items ADD COLUMN content_hash varchar(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'parent_category') THEN
    ALTER TABLE knowledge_items ADD COLUMN parent_category varchar(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'hit_count') THEN
    ALTER TABLE knowledge_items ADD COLUMN hit_count integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'last_hit_at') THEN
    ALTER TABLE knowledge_items ADD COLUMN last_hit_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'adopted_count') THEN
    ALTER TABLE knowledge_items ADD COLUMN adopted_count integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'rejected_count') THEN
    ALTER TABLE knowledge_items ADD COLUMN rejected_count integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'archived_at') THEN
    ALTER TABLE knowledge_items ADD COLUMN archived_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'expires_at') THEN
    ALTER TABLE knowledge_items ADD COLUMN expires_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'image_url') THEN
    ALTER TABLE knowledge_items ADD COLUMN image_url text;
  END IF;
END $$;

-- knowledge_versions 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_versions' AND column_name = 'chunk_diff') THEN
    ALTER TABLE knowledge_versions ADD COLUMN chunk_diff jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_versions' AND column_name = 'chunk_count') THEN
    ALTER TABLE knowledge_versions ADD COLUMN chunk_count integer DEFAULT 0;
  END IF;
END $$;

-- users 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash text;
  END IF;
END $$;

-- customers 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'is_anonymous') THEN
    ALTER TABLE customers ADD COLUMN is_anonymous boolean DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'platform_connection_id') THEN
    ALTER TABLE customers ADD COLUMN platform_connection_id varchar(36);
  END IF;
END $$;

-- quick_replies 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quick_replies' AND column_name = 'platform_connection_id') THEN
    ALTER TABLE quick_replies ADD COLUMN platform_connection_id varchar(36);
  END IF;
END $$;

-- bot_configs 表补充字段
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_configs' AND column_name = 'parent_bot_id') THEN
    ALTER TABLE bot_configs ADD COLUMN parent_bot_id varchar(36);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_configs' AND column_name = 'delegation_prompt') THEN
    ALTER TABLE bot_configs ADD COLUMN delegation_prompt text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_configs' AND column_name = 'collaboration_config') THEN
    ALTER TABLE bot_configs ADD COLUMN collaboration_config jsonb DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_configs' AND column_name = 'is_sub_agent') THEN
    ALTER TABLE bot_configs ADD COLUMN is_sub_agent boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_configs' AND column_name = 'status') THEN
    ALTER TABLE bot_configs ADD COLUMN status varchar(20) NOT NULL DEFAULT 'active';
  END IF;
END $$;

-- =============================================================================
-- PART 2: 创建缺失的表
-- =============================================================================

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
-- 店铺托管客服账号表
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
CREATE INDEX IF NOT EXISTS shop_agent_accounts_status_idx ON shop_agent_accounts(status);

-- ---------------------------------------------------------------------------
-- 尺码配置表
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
-- 知识引用反馈表
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
-- 知识缺口信号表
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
-- Agent委派记录表
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
-- Agent协作通信表
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
-- 模拟测试会话表
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
-- 模拟测试消息表
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
-- 商品详情表
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
-- Webhook 事件处理记录表
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
-- 敏感词表
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
-- URL白名单表
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
-- 过滤日志表
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
-- 坐席分配配置表
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

-- RLS for agent_assignment_config
ALTER TABLE agent_assignment_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow all for authenticated users" ON agent_assignment_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 坐席分配统计表
-- ---------------------------------------------------------------------------
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

-- RLS for agent_assignment_stats
ALTER TABLE agent_assignment_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow all for authenticated users" ON agent_assignment_stats
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 店铺坐席绑定表
-- ---------------------------------------------------------------------------
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

-- RLS for shop_agent_bindings
ALTER TABLE shop_agent_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow all for authenticated users" ON shop_agent_bindings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================================================
-- PART 3: 补充索引
-- =============================================================================

-- customers 唯一索引
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS customers_external_id_unique_idx
    ON customers(source_platform, external_id, platform_connection_id);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'customers_external_id_unique_idx may already exist: %', SQLERRM;
END $$;

-- Gorgias 相关 GIN 索引
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

-- conversations.gorgias_ticket_id 唯一索引
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS conversations_gorgias_ticket_id_unique
    ON conversations((metadata->>'gorgias_ticket_id'))
    WHERE metadata IS NOT NULL AND metadata ? 'gorgias_ticket_id' AND metadata->>'gorgias_ticket_id' IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Index conversations_gorgias_ticket_id_unique may already exist: %', SQLERRM;
END $$;

-- =============================================================================
-- PART 4: RPC 函数
-- =============================================================================

-- RPC 函数：批量增加消息计数
CREATE OR REPLACE FUNCTION increment_message_count_by(conv_id VARCHAR(36), delta INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE conversations
  SET message_count = message_count + delta,
      updated_at = NOW()
  WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;

-- RPC 函数：增加模拟会话消息计数
CREATE OR REPLACE FUNCTION increment_simulation_message_count(conv_id VARCHAR(50))
RETURNS VOID AS $$
BEGIN
  UPDATE simulation_conversations
  SET message_count = message_count + 1,
      updated_at = NOW()
  WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;

-- RPC 函数：尝试获取 Webhook 事件幂等锁
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
-- PART 5: 初始化默认数据
-- =============================================================================

-- 插入默认管理员用户
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

-- 插入默认敏感词分类标签
INSERT INTO customer_tags (id, name, color, category, is_system, customer_count) VALUES
  ('00000000-0000-0000-0000-000000000010', 'VIP客户', '#FFD700', 'manual', true, 0),
  ('00000000-0000-0000-0000-000000000011', '高价值', '#FF6B6B', 'manual', true, 0),
  ('00000000-0000-0000-0000-000000000012', '新客户', '#10B981', 'auto', true, 0),
  ('00000000-0000-0000-0000-000000000013', '活跃客户', '#3B82F6', 'auto', true, 0)
ON CONFLICT (name) DO NOTHING;

-- 插入默认 Bot 配置
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

-- 初始化 health_check
INSERT INTO health_check (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 生成 webhook 密钥
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE key = 'webhook_secret') THEN
    INSERT INTO settings (key, value) VALUES ('webhook_secret', gen_random_uuid()::text);
  END IF;
END $$;

-- =============================================================================
-- PART 6: 数据修复
-- =============================================================================

-- 修复 conversations.gorgias_ticket_id 存储问题
UPDATE conversations
SET metadata = jsonb_set(metadata, '{gorgias_ticket_id}', to_jsonb(CAST(metadata->>'gorgias_ticket_id' AS VARCHAR(50))))
WHERE metadata IS NOT NULL
  AND metadata ? 'gorgias_ticket_id'
  AND metadata->>'gorgias_ticket_id' ~ '^[0-9]+$';

-- 修复 messages.gorgias_message_id 存储问题
UPDATE messages
SET metadata = jsonb_set(metadata, '{gorgias_message_id}', to_jsonb(CAST(metadata->>'gorgias_message_id' AS VARCHAR(50))))
WHERE metadata IS NOT NULL
  AND metadata ? 'gorgias_message_id'
  AND metadata->>'gorgias_message_id' ~ '^[0-9]+$';

COMMIT;

-- =============================================================================
-- 验证：列出所有已创建的表
-- =============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

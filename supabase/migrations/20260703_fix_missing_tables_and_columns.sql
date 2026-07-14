-- ============================================
-- 修复缺失表和字段的数据库迁移脚本
-- 目标: 生产数据库 avmregjnnsmshwxrwjie.supabase.co
-- 创建时间: 2026-07-03
-- ============================================
-- 安全策略: 全部使用 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS 保护性写法
--          不破坏已有数据，遇到已存在的对象自动跳过
-- ============================================

-- ============================================
-- 阶段 0: 基础环境检查
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE '开始执行数据库修复迁移 (2026-07-03)';
  RAISE NOTICE '============================================';
END $$;

-- ============================================
-- 修复 1: 创建 llm_providers 表（如果不存在）
-- 说明: 大模型提供商配置表，存储 OpenAI/DeepSeek/Claude 等配置
-- 对应 schema.ts 第 1070-1106 行
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'llm_providers'
  ) THEN
    CREATE TABLE llm_providers (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      description TEXT,
      api_type VARCHAR(50) NOT NULL DEFAULT 'openai_compatible',
      base_url VARCHAR(500) NOT NULL,
      api_key VARCHAR(500),
      models JSONB NOT NULL DEFAULT '[]',
      default_model VARCHAR(100),
      supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
      supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
      max_context_tokens INTEGER,
      auth_config JSONB,
      request_config JSONB NOT NULL DEFAULT '{}',
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX llm_providers_name_idx ON llm_providers(name);
    CREATE INDEX llm_providers_enabled_idx ON llm_providers(is_enabled);
    CREATE INDEX llm_providers_priority_idx ON llm_providers(priority);
    RAISE NOTICE 'Created table: llm_providers';
  ELSE
    RAISE NOTICE 'Table llm_providers already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 2: 创建 llm_models 表（如果不存在）
-- 说明: LLM 模型表，关联到提供商
-- 对应 schema.ts 第 1111-1147 行
-- 依赖于 llm_providers 表
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'llm_models'
  ) THEN
    CREATE TABLE llm_models (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_id VARCHAR(36) NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
      model_id VARCHAR(100) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      description TEXT,
      type VARCHAR(50) NOT NULL DEFAULT 'chat',
      max_tokens INTEGER,
      supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
      supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
      supports_function_calling BOOLEAN NOT NULL DEFAULT FALSE,
      default_temperature DOUBLE PRECISION NOT NULL DEFAULT 0.7,
      default_max_tokens INTEGER,
      use_case VARCHAR(50) NOT NULL DEFAULT 'general',
      cost_per_1k_input DOUBLE PRECISION,
      cost_per_1k_output DOUBLE PRECISION,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX llm_models_provider_idx ON llm_models(provider_id);
    CREATE INDEX llm_models_type_idx ON llm_models(type);
    CREATE INDEX llm_models_enabled_idx ON llm_models(is_enabled);
    RAISE NOTICE 'Created table: llm_models';
  ELSE
    RAISE NOTICE 'Table llm_models already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 3: 给 product_details 表添加 embedding text 列
-- 说明: Ollama 向量存储列，schema.ts 第 928 行定义
-- 注意: PostgreSQL 16+ 支持 ADD COLUMN IF NOT EXISTS
--       低于 16 版本需要用 DO $$ 块保护
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_details'
      AND column_name = 'embedding'
  ) THEN
    ALTER TABLE product_details ADD COLUMN embedding TEXT;
    RAISE NOTICE 'Added column: product_details.embedding';
  ELSE
    RAISE NOTICE 'Column product_details.embedding already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 4: 给 size_charts 表添加 embedding text 列
-- 说明: Ollama 向量存储列，schema.ts 第 43 行定义
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'size_charts'
      AND column_name = 'embedding'
  ) THEN
    ALTER TABLE size_charts ADD COLUMN embedding TEXT;
    RAISE NOTICE 'Added column: size_charts.embedding';
  ELSE
    RAISE NOTICE 'Column size_charts.embedding already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 5: 给 tickets 表添加缺失字段并重命名
-- 说明:
--   - 添加 parent_ticket_id: 支持子工单（父工单关联）
--   - 添加 custom_fields: 支持自定义字段
--   - 重命名 related_conversation_id -> conversation_id
--     （代码 repository 层期望 conversation_id）
-- 风险: 如果 tickets 表已有 related_conversation_id 数据，
--       重命名会丢失使用该列名的已有代码引用（需同步改代码）
-- ============================================

-- 5a: 添加 parent_ticket_id 列
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'parent_ticket_id'
  ) THEN
    ALTER TABLE tickets ADD COLUMN parent_ticket_id VARCHAR(36);
    -- 添加外键约束（允许 NULL，表示顶层工单）
    ALTER TABLE tickets ADD CONSTRAINT tickets_parent_ticket_id_fkey
      FOREIGN KEY (parent_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
    CREATE INDEX tickets_parent_ticket_id_idx ON tickets(parent_ticket_id);
    RAISE NOTICE 'Added column: tickets.parent_ticket_id with FK and index';
  ELSE
    RAISE NOTICE 'Column tickets.parent_ticket_id already exists, skipping.';
  END IF;
END $$;

-- 5b: 添加 custom_fields jsonb 列
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'custom_fields'
  ) THEN
    ALTER TABLE tickets ADD COLUMN custom_fields JSONB DEFAULT '{}';
    RAISE NOTICE 'Added column: tickets.custom_fields';
  ELSE
    RAISE NOTICE 'Column tickets.custom_fields already exists, skipping.';
  END IF;
END $$;

-- 5c: 重命名 related_conversation_id -> conversation_id
-- 注意: 使用重命名函数，如果列不存在（已经被改名）则跳过
DO $$
DECLARE
  _col_exists BOOLEAN;
BEGIN
  -- 先检查原列是否存在
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'related_conversation_id'
  ) INTO _col_exists;

  IF _col_exists THEN
    -- 再检查目标列是否已存在（可能被其他迁移先执行了）
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tickets'
        AND column_name = 'conversation_id'
    ) THEN
      ALTER TABLE tickets RENAME COLUMN related_conversation_id TO conversation_id;
      RAISE NOTICE 'Renamed column: tickets.related_conversation_id -> tickets.conversation_id';
    ELSE
      -- 目标列已存在（可能已被改名或迁移），删除源列避免冲突
      ALTER TABLE tickets DROP COLUMN IF EXISTS related_conversation_id;
      RAISE NOTICE 'Dropped column: tickets.related_conversation_id (target already existed)';
    END IF;
  ELSE
    -- 检查是否已经是 conversation_id
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tickets'
        AND column_name = 'conversation_id'
    ) THEN
      RAISE NOTICE 'Column tickets.conversation_id already exists, no rename needed.';
    ELSE
      -- 两个列都不存在，创建 conversation_id（无数据迁移）
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tickets'
          AND column_name = 'conversation_id'
      ) THEN
        ALTER TABLE tickets ADD COLUMN conversation_id VARCHAR(36);
        RAISE NOTICE 'Added column: tickets.conversation_id (source column did not exist)';
      END IF;
    END IF;
  END IF;
END $$;

-- ============================================
-- 修复 6: 给 agent_assignment_config 表添加缺失字段
-- 说明: 代码层期望字段 shop_id / max_concurrent / is_enabled / condition_config
--       当前 DB 已有: strategy / name / is_enabled / condition_config
--       缺少: shop_id / max_concurrent
-- ============================================

DO $$
BEGIN
  -- 6a: 添加 shop_id 字段（VARCHAR，可为空，兼容多店铺场景）
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_assignment_config'
      AND column_name = 'shop_id'
  ) THEN
    ALTER TABLE agent_assignment_config ADD COLUMN shop_id VARCHAR(36);
    -- 可选: 添加外键（如果 shops 表已存在）
    -- 注意: 不加 ON DELETE CASCADE，因为全局策略不需要店铺
    RAISE NOTICE 'Added column: agent_assignment_config.shop_id';
  ELSE
    RAISE NOTICE 'Column agent_assignment_config.shop_id already exists, skipping.';
  END IF;
END $$;

DO $$
BEGIN
  -- 6b: 添加 max_concurrent 字段（坐席最大并发数）
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_assignment_config'
      AND column_name = 'max_concurrent'
  ) THEN
    ALTER TABLE agent_assignment_config ADD COLUMN max_concurrent INTEGER DEFAULT 5;
    RAISE NOTICE 'Added column: agent_assignment_config.max_concurrent (default: 5)';
  ELSE
    RAISE NOTICE 'Column agent_assignment_config.max_concurrent already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 7: 给 agent_assignment_stats 表添加缺失字段
-- 说明: 代码层期望字段 resolved_count / avg_handle_time
--       当前 DB 已有: user_id / date / assigned_count / active_conversations
--                   / completed_count / last_assigned_at
--       缺少: resolved_count / avg_handle_time
-- 注意: DB 使用 user_id（不是 agent_id），代码已对齐，无需修改
-- ============================================

DO $$
BEGIN
  -- 7a: 添加 resolved_count 字段（坐席已解决工单数）
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_assignment_stats'
      AND column_name = 'resolved_count'
  ) THEN
    ALTER TABLE agent_assignment_stats ADD COLUMN resolved_count INTEGER DEFAULT 0;
    RAISE NOTICE 'Added column: agent_assignment_stats.resolved_count';
  ELSE
    RAISE NOTICE 'Column agent_assignment_stats.resolved_count already exists, skipping.';
  END IF;
END $$;

DO $$
BEGIN
  -- 7b: 添加 avg_handle_time 字段（平均处理时长，秒）
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_assignment_stats'
      AND column_name = 'avg_handle_time'
  ) THEN
    ALTER TABLE agent_assignment_stats ADD COLUMN avg_handle_time DOUBLE PRECISION DEFAULT 0;
    RAISE NOTICE 'Added column: agent_assignment_stats.avg_handle_time';
  ELSE
    RAISE NOTICE 'Column agent_assignment_stats.avg_handle_time already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 8: 给 shop_agent_bindings 表添加 role 字段
-- 说明: 代码层（ShopAgentBindingRow）期望 role 字段标识坐席角色
--       当前 DB 可能没有此字段
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shop_agent_bindings'
      AND column_name = 'role'
  ) THEN
    ALTER TABLE shop_agent_bindings ADD COLUMN role VARCHAR(50) DEFAULT 'agent';
    RAISE NOTICE 'Added column: shop_agent_bindings.role (default: agent)';
  ELSE
    RAISE NOTICE 'Column shop_agent_bindings.role already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 9: 给 platform_connections 表添加 name 字段
-- 说明: 诊断发现该表缺少 name 字段，用户友好名称
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'platform_connections'
      AND column_name = 'name'
  ) THEN
    ALTER TABLE platform_connections ADD COLUMN name VARCHAR(255);
    RAISE NOTICE 'Added column: platform_connections.name';
  ELSE
    RAISE NOTICE 'Column platform_connections.name already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 10: 给 tickets 表添加 conversation_id 索引（如果不存在）
-- 说明: conversation_id 重命名后，确保有合适的索引
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND indexname = 'tickets_conversation_id_idx'
  ) THEN
    CREATE INDEX tickets_conversation_id_idx ON tickets(conversation_id);
    RAISE NOTICE 'Created index: tickets_conversation_id_idx';
  ELSE
    RAISE NOTICE 'Index tickets_conversation_id_idx already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 11: 给 shop_agent_bindings 表添加复合唯一索引（如果不存在）
-- 说明: 防止同一店铺同一坐席重复绑定
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'shop_agent_bindings'
      AND indexname = 'shop_agent_bindings_shop_user_unique'
  ) THEN
    CREATE UNIQUE INDEX shop_agent_bindings_shop_user_unique
      ON shop_agent_bindings(shop_id, user_id);
    RAISE NOTICE 'Created unique index: shop_agent_bindings_shop_user_unique';
  ELSE
    RAISE NOTICE 'Index shop_agent_bindings_shop_user_unique already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 修复 12: 给 tickets 表添加 updated_at 默认值（如果不存在）
-- 说明: tickets.updated_at 可能已有但没有默认值，无法自动更新
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE tickets ADD COLUMN updated_at TIMESTAMPTZ;
    RAISE NOTICE 'Added column: tickets.updated_at';
  ELSE
    RAISE NOTICE 'Column tickets.updated_at already exists, skipping.';
  END IF;
END $$;

-- ============================================
-- 完成
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE '数据库修复迁移完成 (2026-07-03)';
  RAISE NOTICE '============================================';
  RAISE NOTICE '执行的修复:';
  RAISE NOTICE '  1. llm_providers 表创建';
  RAISE NOTICE '  2. llm_models 表创建';
  RAISE NOTICE '  3. product_details.embedding 列';
  RAISE NOTICE '  4. size_charts.embedding 列';
  RAISE NOTICE '  5. tickets.parent_ticket_id + custom_fields + related_conversation_id -> conversation_id';
  RAISE NOTICE '  6. agent_assignment_config.shop_id + max_concurrent';
  RAISE NOTICE '  7. agent_assignment_stats.resolved_count + avg_handle_time';
  RAISE NOTICE '  8. shop_agent_bindings.role';
  RAISE NOTICE '  9. platform_connections.name';
  RAISE NOTICE ' 10. tickets_conversation_id_idx 索引';
  RAISE NOTICE ' 11. shop_agent_bindings_shop_user_unique 索引';
  RAISE NOTICE ' 12. tickets.updated_at';
END $$;

-- ============================================
-- 迁移脚本：从旧 Supabase 迁移到火山引擎 Coze Supabase
-- 日期: 2026-06-27
-- 描述: 添加缺失的工单系统扩展表
-- ============================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 工单分类表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_categories (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  parent_id VARCHAR(36) REFERENCES ticket_categories(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ticket_categories_parent_id ON ticket_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_ticket_categories_is_active ON ticket_categories(is_active);

-- ---------------------------------------------------------------------------
-- 工单自定义字段表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_custom_fields (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  field_key VARCHAR(50) NOT NULL UNIQUE,
  field_type VARCHAR(20) NOT NULL DEFAULT 'text',
  options JSONB DEFAULT '[]',
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  default_value TEXT,
  placeholder TEXT,
  category_ids VARCHAR(36)[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ticket_custom_fields_field_key ON ticket_custom_fields(field_key);
CREATE INDEX IF NOT EXISTS idx_ticket_custom_fields_is_active ON ticket_custom_fields(is_active);
CREATE INDEX IF NOT EXISTS idx_ticket_custom_fields_display_order ON ticket_custom_fields(display_order);

-- ---------------------------------------------------------------------------
-- 工单字段值表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_field_values (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id VARCHAR(36) NOT NULL,
  field_id VARCHAR(36) NOT NULL,
  field_key VARCHAR(50) NOT NULL,
  field_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ,
  UNIQUE(ticket_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_field_values_ticket_id ON ticket_field_values(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_field_values_field_id ON ticket_field_values(field_id);
CREATE INDEX IF NOT EXISTS idx_ticket_field_values_field_key ON ticket_field_values(field_key);

-- ---------------------------------------------------------------------------
-- 工单关联表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_relations (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ticket_id VARCHAR(36) NOT NULL,
  target_ticket_id VARCHAR(36) NOT NULL,
  relation_type VARCHAR(20) NOT NULL DEFAULT 'related',
  created_by VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(source_ticket_id, target_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_relations_source ON ticket_relations(source_ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_relations_target ON ticket_relations(target_ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_relations_type ON ticket_relations(relation_type);

-- ---------------------------------------------------------------------------
-- 工单审计日志表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_audit_log (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id VARCHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  actor_id VARCHAR(36),
  actor_name VARCHAR(100),
  changes JSONB,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_audit_log_ticket_id ON ticket_audit_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_audit_log_actor_id ON ticket_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_ticket_audit_log_action ON ticket_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_ticket_audit_log_created_at ON ticket_audit_log(created_at);

-- ---------------------------------------------------------------------------
-- 知识库 Chunk 表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id VARCHAR(100) PRIMARY KEY,
  knowledge_item_id VARCHAR(36) NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  doc_id VARCHAR(100),
  version_added INTEGER DEFAULT 1,
  version_removed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parent_chunk_id VARCHAR(100),
  chunk_level VARCHAR(10) DEFAULT 'child',
  doc_type VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_item_id ON knowledge_chunks(knowledge_item_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_parent_id ON knowledge_chunks(parent_chunk_id) WHERE parent_chunk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_level ON knowledge_chunks(chunk_level);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc_type ON knowledge_chunks(doc_type);

-- 添加注释
COMMENT ON TABLE knowledge_chunks IS '知识库文本分片表，支持父子分片架构';
COMMENT ON TABLE ticket_categories IS '工单分类表，支持层级结构';
COMMENT ON TABLE ticket_custom_fields IS '工单自定义字段定义表';
COMMENT ON TABLE ticket_field_values IS '工单自定义字段值表';
COMMENT ON TABLE ticket_relations IS '工单关联表（blocks/related/duplicates）';
COMMENT ON TABLE ticket_audit_log IS '工单操作审计日志表';

COMMIT;

-- 验证
DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully. Created tables:';
  RAISE NOTICE '  - knowledge_chunks';
  RAISE NOTICE '  - ticket_categories';
  RAISE NOTICE '  - ticket_custom_fields';
  RAISE NOTICE '  - ticket_field_values';
  RAISE NOTICE '  - ticket_relations';
  RAISE NOTICE '  - ticket_audit_log';
END $$;

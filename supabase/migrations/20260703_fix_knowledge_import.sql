-- ============================================
-- 修复知识库导入失败 - 创建缺失的表
-- 执行方式: Supabase Dashboard > SQL Editor > 粘贴执行
-- ============================================

-- 1. 创建 knowledge_chunks 表（如果不存在）
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
    embedding TEXT,
    parent_chunk_id VARCHAR(100),
    chunk_level VARCHAR(10) DEFAULT 'child',
    doc_type VARCHAR(20)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_item_id ON knowledge_chunks(knowledge_item_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_parent_id ON knowledge_chunks(parent_chunk_id) WHERE parent_chunk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_level ON knowledge_chunks(chunk_level);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc_type ON knowledge_chunks(doc_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_hash ON knowledge_chunks(content_hash);

-- 2. 创建 knowledge_import_jobs 表（如果不存在）
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
    knowledge_item_id VARCHAR(36),
    category VARCHAR(100) DEFAULT '未分类',
    parent_category VARCHAR(100),
    image_url TEXT,
    created_by VARCHAR(36),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- 创建索引
CREATE INDEX IF NOT EXISTS kij_status_idx ON knowledge_import_jobs(status);
CREATE INDEX IF NOT EXISTS kij_created_at_idx ON knowledge_import_jobs(created_at);
CREATE INDEX IF NOT EXISTS kij_created_by_idx ON knowledge_import_jobs(created_by);

-- 3. 添加 knowledge_import_jobs 的缺失列（如果表已存在但列缺失）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'knowledge_import_jobs') THEN
    ALTER TABLE knowledge_import_jobs ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT '未分类';
    ALTER TABLE knowledge_import_jobs ADD COLUMN IF NOT EXISTS parent_category VARCHAR(100);
    ALTER TABLE knowledge_import_jobs ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE knowledge_import_jobs ADD COLUMN IF NOT EXISTS knowledge_item_id VARCHAR(36);
    ALTER TABLE knowledge_import_jobs ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE knowledge_import_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- 4. 禁用 RLS（解决导入失败的核心问题）
ALTER TABLE knowledge_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_import_jobs DISABLE ROW LEVEL SECURITY;

-- 5. 刷新 PostgREST schema cache
NOTIFY pgrst, 'reload';

-- 6. 验证
SELECT 
    'Tables created/updated' AS action,
    table_name
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('knowledge_chunks', 'knowledge_import_jobs')
ORDER BY table_name;

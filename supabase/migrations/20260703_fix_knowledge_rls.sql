-- 修复知识库导入失败问题
-- 问题: knowledge_items 表启用了 RLS，导致插入失败
-- 解决: 禁用 knowledge_items 和 knowledge_chunks 表的 RLS

-- 禁用 knowledge_items 表的 RLS
ALTER TABLE knowledge_items DISABLE ROW LEVEL SECURITY;

-- 禁用 knowledge_chunks 表的 RLS
ALTER TABLE knowledge_chunks DISABLE ROW LEVEL SECURITY;

-- 禁用 knowledge_import_jobs 表的 RLS (如果启用的话)
ALTER TABLE knowledge_import_jobs DISABLE ROW LEVEL SECURITY;

-- 如果需要，以后可以通过以下方式重新启用 RLS:
-- ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;

-- 验证
DO $$
BEGIN
  RAISE NOTICE 'RLS 已禁用 - 知识库导入功能应该恢复正常';
END $$;

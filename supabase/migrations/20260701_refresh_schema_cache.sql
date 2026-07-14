-- ============================================
-- 补充缺失列 + 刷新 PostgREST Schema Cache
-- 执行方式: Supabase Dashboard > SQL Editor > 粘贴执行
-- ============================================

-- 1. knowledge_import_jobs 缺失的列
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'knowledge_import_jobs') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_import_jobs' AND column_name = 'category') THEN
      ALTER TABLE knowledge_import_jobs ADD COLUMN category VARCHAR(100) DEFAULT '未分类';
      RAISE NOTICE 'Added: knowledge_import_jobs.category';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_import_jobs' AND column_name = 'parent_category') THEN
      ALTER TABLE knowledge_import_jobs ADD COLUMN parent_category VARCHAR(100);
      RAISE NOTICE 'Added: knowledge_import_jobs.parent_category';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_import_jobs' AND column_name = 'image_url') THEN
      ALTER TABLE knowledge_import_jobs ADD COLUMN image_url TEXT;
      RAISE NOTICE 'Added: knowledge_import_jobs.image_url';
    END IF;
  ELSE
    RAISE NOTICE 'Table knowledge_import_jobs does not exist yet - skipping';
  END IF;
END $$;

-- 2. knowledge_items embedding 列 (来自 20260702_ollama_embedding.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'knowledge_items') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'knowledge_items' AND column_name = 'embedding') THEN
      ALTER TABLE knowledge_items ADD COLUMN embedding TEXT;
      RAISE NOTICE 'Added: knowledge_items.embedding';
    END IF;
  ELSE
    RAISE NOTICE 'Table knowledge_items does not exist yet - skipping';
  END IF;
END $$;

-- 3. 通知 PostgREST 重新加载 schema
NOTIFY pgrst, 'reload';

-- 4. 验证
SELECT 'Schema Cache Refreshed' AS status;

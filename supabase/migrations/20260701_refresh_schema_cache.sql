-- ============================================
-- 刷新 PostgREST Schema Cache
-- 
-- 在 Supabase Dashboard > SQL Editor 中执行此脚本
-- ============================================

-- 1. 通知 PostgREST 重新加载 schema
NOTIFY pgrst, 'reload';

-- 2. 等待几秒后验证表是否可访问
SELECT 
    'PostgREST Schema Cache 已刷新' AS status,
    count(*) AS llm_providers_count 
FROM llm_providers;

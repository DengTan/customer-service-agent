-- ============================================
-- Bot与店铺绑定：补充缺失的platform_connection_id列
-- 执行方式: Supabase Dashboard > SQL Editor > 粘贴执行
-- ============================================

-- 1. 添加 platform_connection_id 字段到 bot_configs 表（如果不存在）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bot_configs') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bot_configs' AND column_name = 'platform_connection_id') THEN
      ALTER TABLE bot_configs ADD COLUMN platform_connection_id VARCHAR(36);
      RAISE NOTICE 'Added: bot_configs.platform_connection_id';
    ELSE
      RAISE NOTICE 'Column bot_configs.platform_connection_id already exists';
    END IF;
  ELSE
    RAISE NOTICE 'Table bot_configs does not exist yet - skipping';
  END IF;
END $$;

-- 2. 添加索引（如果不存在）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'bot_configs' 
    AND indexname = 'bot_configs_platform_connection_id_idx'
  ) THEN
    CREATE INDEX bot_configs_platform_connection_id_idx ON bot_configs(platform_connection_id) WHERE platform_connection_id IS NOT NULL;
    RAISE NOTICE 'Created index: bot_configs_platform_connection_id_idx';
  ELSE
    RAISE NOTICE 'Index bot_configs_platform_connection_id_idx already exists';
  END IF;
END $$;

-- 3. 处理现有重复数据并添加唯一约束
DO $$
DECLARE
    r RECORD;
    duplicate_ids TEXT[];
BEGIN
    -- 查找有重复 platform_connection_id 的记录
    FOR r IN
        SELECT platform_connection_id
        FROM bot_configs
        WHERE platform_connection_id IS NOT NULL
        GROUP BY platform_connection_id
        HAVING COUNT(*) > 1
    LOOP
        -- 获取重复的ID，保留最早创建的
        SELECT ARRAY(
            SELECT id
            FROM bot_configs
            WHERE platform_connection_id = r.platform_connection_id
            ORDER BY created_at ASC
            OFFSET 1
        ) INTO duplicate_ids;

        -- 将重复记录的 platform_connection_id 设为 NULL
        UPDATE bot_configs SET platform_connection_id = NULL WHERE id = ANY(duplicate_ids);
        RAISE NOTICE 'Cleaned up duplicate platform_connection_id for bots: %', duplicate_ids;
    END LOOP;
END $$;

-- 4. 添加唯一约束（如果不存在）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_configs_shop_unique'
  ) THEN
    ALTER TABLE bot_configs ADD CONSTRAINT bot_configs_shop_unique UNIQUE (platform_connection_id);
    RAISE NOTICE 'Added constraint: bot_configs_shop_unique';
  ELSE
    RAISE NOTICE 'Constraint bot_configs_shop_unique already exists';
  END IF;
END $$;

-- 5. 通知 PostgREST 重新加载 schema
NOTIFY pgrst, 'reload';

-- 6. 验证
SELECT 
  'bot_configs' AS table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bot_configs'
ORDER BY ordinal_position;

SELECT 'Schema Cache Refreshed + platform_connection_id added' AS status;

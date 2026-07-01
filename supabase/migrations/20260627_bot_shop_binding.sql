-- ============================================
-- Bot与店铺绑定：bot_configs增加platform_connection_id字段
-- 每个店铺只能绑定一个Bot
-- ============================================

-- 1. 添加 platform_connection_id 字段到 bot_configs 表
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS platform_connection_id VARCHAR(36);

-- 2. 添加索引
CREATE INDEX IF NOT EXISTS bot_configs_platform_connection_id_idx ON bot_configs(platform_connection_id) WHERE platform_connection_id IS NOT NULL;

-- 3. 添加唯一约束：同一店铺只能有一个Bot（排除未绑定店铺的重复）
-- 注意：先处理现有数据，确保没有重复
-- 如果已有同一 platform_connection_id 的多个 Bot，保留最早创建的
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

        -- 将重复记录的 platform_connection_id 设为 NULL（使其可删）
        UPDATE bot_configs SET platform_connection_id = NULL WHERE id = ANY(duplicate_ids);
    END LOOP;
END $$;

-- 4. 创建唯一约束：同一店铺只能有一个Bot
-- 使用表达式索引来实现：只有当 platform_connection_id 不为 NULL 时才强制唯一
-- 方式1：使用 COALESCE 将 NULL 转为特殊值，然后对非 NULL 值唯一
-- 方式2（推荐）：使用 WHERE 子句的部分索引已经足够，配合 INSERT/UPDATE 触发器检查

-- 为简化处理，使用唯一索引但排除 NULL 值（PostgreSQL 默认行为）
-- 如果需要更强的约束，可以在应用层或使用触发器确保唯一性
ALTER TABLE bot_configs ADD CONSTRAINT bot_configs_shop_unique UNIQUE (platform_connection_id);

-- 5. 注释说明
COMMENT ON COLUMN bot_configs.platform_connection_id IS '关联的店铺ID，每个店铺只能绑定一个Bot，NULL表示全局Bot';

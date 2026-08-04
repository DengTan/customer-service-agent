-- ============================================
-- Fix P0 Schema Issues (2026-08-04)
-- P0-1: tickets 缺少 resolved_at、closed_at、custom_fields
-- P0-2: bot_configs 缺少 platform_connection_id
-- ============================================

-- P0-1: tickets 表添加缺失字段

-- resolved_at: 解决问题时间
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- closed_at: 关闭时间
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- custom_fields: 自定义字段 JSONB（确保有默认值，兼容已有数据）
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
ALTER TABLE tickets ALTER COLUMN custom_fields DROP DEFAULT;

-- P0-2: bot_configs 表添加 platform_connection_id

-- platform_connection_id: 关联的店铺ID（外键引用 shops.id，删除时设为 null）
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS platform_connection_id UUID REFERENCES shops(id) ON DELETE SET NULL;

-- 添加索引加速按店铺查询 Bot
CREATE INDEX IF NOT EXISTS bot_configs_platform_connection_id_idx ON bot_configs(platform_connection_id);

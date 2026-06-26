-- 移除 agent_assignment_config 表的 priority 字段
-- 创建时间: 2026-06-26
-- 描述: 简化坐席分配配置，移除未使用的 priority 字段

-- 移除 priority 字段（如果存在）
ALTER TABLE IF EXISTS agent_assignment_config DROP COLUMN IF EXISTS priority;

-- 移除不再需要的优先级索引
DROP INDEX IF EXISTS idx_agent_assignment_config_priority;

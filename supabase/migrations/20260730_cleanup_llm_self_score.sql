-- 清理 messages / simulation_messages 表 metadata 中已废弃的 llm_self_score 字段
-- 背景：ConfidenceBreakdown 类型重构后，llm_self_score 已从 TS 接口移除，新消息不再写入。
-- 但历史 JSON 数据中仍残留该 key，对功能无影响（jsonb 无 schema 校验，TS 类型断言会丢弃多余字段），
-- 本迁移用于清理死字段、节省磁盘空间、保持数据整洁。

-- 影响行数预估（执行前可先 SELECT 验证）：
--   SELECT count(*) FROM messages
--     WHERE metadata ? 'llm_self_score' OR confidence_breakdown ? 'llm_self_score';
--   SELECT count(*) FROM simulation_messages
--     WHERE confidence_breakdown ? 'llm_self_score';

-- 1) messages.metadata
UPDATE messages
SET metadata = metadata - 'llm_self_score'
WHERE metadata ? 'llm_self_score';

-- 2) messages.confidence_breakdown
UPDATE messages
SET confidence_breakdown = confidence_breakdown - 'llm_self_score'
WHERE confidence_breakdown ? 'llm_self_score';

-- 3) simulation_messages.confidence_breakdown
UPDATE simulation_messages
SET confidence_breakdown = confidence_breakdown - 'llm_self_score'
WHERE confidence_breakdown ? 'llm_self_score';
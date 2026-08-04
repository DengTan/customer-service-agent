-- ============================================
-- Fix TypeScript/Schema Sync Issues (2026-08-04)
-- #6:  quick_replies 表缺少 platform_connection_id
-- #9:  conversations.participant_ids 缺少 GIN 索引
-- #11: simulation_conversations.id 类型对齐（Schema: varchar(50), Types: string）
-- ============================================

-- #6: quick_replies 表添加 platform_connection_id

ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS platform_connection_id UUID REFERENCES shops(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS quick_replies_platform_connection_id_idx ON quick_replies(platform_connection_id);

-- #9: conversations.participant_ids 添加 GIN 索引（支持 @> 包含查询）

CREATE INDEX IF NOT EXISTS conversations_participant_ids_idx ON conversations USING GIN (participant_ids);

-- #11: simulation_conversations.id 已在 DB 层定义为 varchar(50)，
-- TypeScript 层添加 SimulationConversationRow 类型定义与 schema 对齐

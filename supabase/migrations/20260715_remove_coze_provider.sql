-- ============================================
-- 移除 Coze 提供商（2026-07-15）
-- ============================================
-- 此迁移移除默认插入的 Coze 提供商数据
-- 由于已移除 Coze 支持，不再需要 Coze 提供商

-- 删除 Coze 提供商
DELETE FROM llm_providers WHERE name = 'coze';

-- 删除关联的 Coze 模型
DELETE FROM llm_models WHERE provider_id IN (
    SELECT id FROM llm_providers WHERE name = 'coze'
);

-- 添加 CHECK 约束，禁止使用 coze 作为 api_type
-- 注意：历史迁移中已插入的数据不受影响，仅对新插入生效
-- ALTER TABLE llm_providers ADD CONSTRAINT llm_providers_api_type_check 
--     CHECK (api_type IN ('openai_compatible', 'anthropic', 'custom'));

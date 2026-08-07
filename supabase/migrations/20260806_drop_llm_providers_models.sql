-- 移除 llm_providers 表中的 models 字段
-- 所有模型配置已迁移至独立的 llm_models 表
ALTER TABLE llm_providers DROP COLUMN IF EXISTS models;

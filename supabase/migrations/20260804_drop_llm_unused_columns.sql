-- 清理 llm_providers 和 llm_models 表中的无用字段
-- 这些字段已在应用代码中移除

-- llm_providers 表：删除 priority 和 default_model 字段
ALTER TABLE llm_providers DROP COLUMN IF EXISTS priority;
ALTER TABLE llm_providers DROP COLUMN IF EXISTS default_model;

-- llm_models 表：删除 priority 和 default_temperature 字段，添加 type 字段
ALTER TABLE llm_models DROP COLUMN IF EXISTS priority;
ALTER TABLE llm_models DROP COLUMN IF EXISTS default_temperature;
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS type varchar(20) NOT NULL DEFAULT 'chat';

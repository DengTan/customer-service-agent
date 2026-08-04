-- 删除 llm_providers 表中的 is_default 字段
ALTER TABLE llm_providers DROP COLUMN IF EXISTS is_default;

-- 修复 llm_models 表中 type='default' 的无效数据
-- 背景：早期开发时可能使用了 'default' 作为类型值，与下拉选项（chat/embedding/rerank/vision）不一致

-- 1. 查看当前所有 type 值
SELECT DISTINCT type FROM llm_models;

-- 2. 将 default 改为 chat
UPDATE llm_models SET type = 'chat' WHERE type = 'default';

-- 3. 验证修复结果
SELECT id, model_id, display_name, type FROM llm_models;

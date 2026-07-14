-- ============================================
-- Sensenova LLM Provider 迁移
-- 添加 Sensenova 模型提供商
-- ============================================

-- 插入 Sensenova 提供商
INSERT INTO llm_providers (
    id,
    name,
    display_name,
    description,
    api_type,
    base_url,
    models,
    default_model,
    supports_vision,
    supports_streaming,
    max_context_tokens,
    is_enabled,
    is_default,
    priority
) VALUES (
    'sensenova-provider',
    'sensenova',
    'Sensenova (稀宇科技)',
    '稀宇科技 Sensenova 模型，高性价比对话模型',
    'openai_compatible',
    'https://token.sensenova.cn/v1',
    '["sensenova-6.7-flash-lite", "sensenova-6.7-flash", "sensenova-6.7-plus", "sensenova-14b-plus"]'::JSONB,
    'sensenova-6.7-flash-lite',
    FALSE,
    TRUE,
    128000,
    TRUE,
    FALSE,
    80
) ON CONFLICT (name) DO NOTHING;

-- 为 Sensenova 提供商插入默认模型
INSERT INTO llm_models (
    provider_id,
    model_id,
    display_name,
    description,
    type,
    max_tokens,
    supports_vision,
    supports_streaming,
    supports_function_calling,
    default_temperature,
    default_max_tokens,
    use_case
) SELECT 
    p.id,
    'sensenova-6.7-flash-lite',
    'Sensenova 6.7 Flash Lite',
    '轻量快速，适合日常对话，高并发支持',
    'chat',
    8192,
    FALSE,
    TRUE,
    TRUE,
    0.7,
    4096,
    'fast'
FROM llm_providers p WHERE p.name = 'sensenova' AND NOT EXISTS (
    SELECT 1 FROM llm_models m WHERE m.provider_id = p.id AND m.model_id = 'sensenova-6.7-flash-lite'
);

INSERT INTO llm_models (
    provider_id,
    model_id,
    display_name,
    description,
    type,
    max_tokens,
    supports_vision,
    supports_streaming,
    supports_function_calling,
    default_temperature,
    default_max_tokens,
    use_case
) SELECT 
    p.id,
    'sensenova-6.7-flash',
    'Sensenova 6.7 Flash',
    '标准版对话模型，平衡性能与成本',
    'chat',
    8192,
    FALSE,
    TRUE,
    TRUE,
    0.7,
    4096,
    'general'
FROM llm_providers p WHERE p.name = 'sensenova' AND NOT EXISTS (
    SELECT 1 FROM llm_models m WHERE m.provider_id = p.id AND m.model_id = 'sensenova-6.7-flash'
);

INSERT INTO llm_models (
    provider_id,
    model_id,
    display_name,
    description,
    type,
    max_tokens,
    supports_vision,
    supports_streaming,
    supports_function_calling,
    default_temperature,
    default_max_tokens,
    use_case
) SELECT 
    p.id,
    'sensenova-6.7-plus',
    'Sensenova 6.7 Plus',
    '增强版模型，更好的推理能力',
    'chat',
    16384,
    FALSE,
    TRUE,
    TRUE,
    0.5,
    8192,
    'quality'
FROM llm_providers p WHERE p.name = 'sensenova' AND NOT EXISTS (
    SELECT 1 FROM llm_models m WHERE m.provider_id = p.id AND m.model_id = 'sensenova-6.7-plus'
);

INSERT INTO llm_models (
    provider_id,
    model_id,
    display_name,
    description,
    type,
    max_tokens,
    supports_vision,
    supports_streaming,
    supports_function_calling,
    default_temperature,
    default_max_tokens,
    use_case
) SELECT 
    p.id,
    'sensenova-14b-plus',
    'Sensenova 14B Plus',
    '14B 参数增强模型，适合复杂推理任务',
    'chat',
    16384,
    FALSE,
    TRUE,
    TRUE,
    0.5,
    8192,
    'reasoning'
FROM llm_providers p WHERE p.name = 'sensenova' AND NOT EXISTS (
    SELECT 1 FROM llm_models m WHERE m.provider_id = p.id AND m.model_id = 'sensenova-14b-plus'
);

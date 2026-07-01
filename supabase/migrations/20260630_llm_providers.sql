-- ============================================
-- LLM Provider 扩展表迁移
-- ============================================
-- 支持扩展额外的大模型 API 提供商（OpenAI、DeepSeek、Claude 等）

-- 创建大模型提供商配置表
CREATE TABLE IF NOT EXISTS llm_providers (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 提供商标识
    name VARCHAR(100) NOT NULL UNIQUE, -- 唯一标识，如 openai/deepseek/claude
    display_name VARCHAR(100) NOT NULL, -- 显示名称
    description TEXT, -- 描述
    -- API 配置
    api_type VARCHAR(50) NOT NULL DEFAULT 'openai_compatible', -- openai_compatible / coze / anthropic / custom
    base_url VARCHAR(500) NOT NULL, -- API 基础 URL
    api_key VARCHAR(500), -- API Key（加密存储）
    -- 模型配置
    models JSONB NOT NULL DEFAULT '[]', -- 可用模型列表
    default_model VARCHAR(100), -- 默认模型
    -- 功能支持
    supports_vision BOOLEAN NOT NULL DEFAULT FALSE, -- 是否支持视觉（多模态）
    supports_streaming BOOLEAN NOT NULL DEFAULT TRUE, -- 是否支持流式输出
    max_context_tokens INTEGER, -- 最大上下文 Token 数
    -- 认证配置（可选的额外配置）
    auth_config JSONB, -- 额外认证参数（如 organization, project 等）
    -- 请求配置
    request_config JSONB NOT NULL DEFAULT '{}', -- 请求配置（超时、重试等）
    -- 状态
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE, -- 是否启用
    is_default BOOLEAN NOT NULL DEFAULT FALSE, -- 是否为默认提供商
    priority INTEGER NOT NULL DEFAULT 0, -- 优先级（数字越大优先级越高）
    -- 审计字段
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 创建索引
CREATE INDEX IF NOT EXISTS llm_providers_name_idx ON llm_providers(name);
CREATE INDEX IF NOT EXISTS llm_providers_enabled_idx ON llm_providers(is_enabled);
CREATE INDEX IF NOT EXISTS llm_providers_priority_idx ON llm_providers(priority);

-- 创建 LLM 模型表（关联到提供商）
CREATE TABLE IF NOT EXISTS llm_models (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 关联到提供商
    provider_id VARCHAR(36) NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
    -- 模型标识
    model_id VARCHAR(100) NOT NULL, -- API 中的模型 ID
    display_name VARCHAR(100) NOT NULL, -- 显示名称
    description TEXT, -- 模型描述
    -- 模型能力
    type VARCHAR(50) NOT NULL DEFAULT 'chat', -- chat / embedding / vision / audio
    max_tokens INTEGER, -- 最大输出 Token
    -- 功能支持
    supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
    supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
    supports_function_calling BOOLEAN NOT NULL DEFAULT FALSE,
    -- 性能参数
    default_temperature DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    default_max_tokens INTEGER, -- 默认最大输出
    -- 用途标记
    use_case VARCHAR(50) NOT NULL DEFAULT 'general', -- general / fast / quality / reasoning
    -- 成本信息（可选）
    cost_per_1k_input DOUBLE PRECISION, -- 每 1000 输入 Token 成本
    cost_per_1k_output DOUBLE PRECISION, -- 每 1000 输出 Token 成本
    -- 状态
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- 审计字段
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 创建索引
CREATE INDEX IF NOT EXISTS llm_models_provider_idx ON llm_models(provider_id);
CREATE INDEX IF NOT EXISTS llm_models_type_idx ON llm_models(type);
CREATE INDEX IF NOT EXISTS llm_models_enabled_idx ON llm_models(is_enabled);

-- ============================================
-- 插入默认的 Coze 提供商（与现有配置兼容）
-- ============================================
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
    'default-coze-provider',
    'coze',
    'Coze (豆包)',
    '火山引擎 Coze 平台，默认提供商',
    'coze',
    'https://ark.cn-beijing.volces.com/api/v3',
    '["doubao-seed-2-0-lite-260215", "doubao-seed-1-6-250615", "deepseek-v3-250324"]'::JSONB,
    'doubao-seed-2-0-lite-260215',
    TRUE,
    TRUE,
    128000,
    TRUE,
    TRUE,
    100
) ON CONFLICT (name) DO NOTHING;

-- 为 Coze 提供商插入默认模型
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
    'doubao-seed-2-0-lite-260215',
    'Doubao Seed 2.0 Lite',
    '轻量快速，适合日常对话',
    'chat',
    4096,
    FALSE,
    TRUE,
    TRUE,
    0.7,
    2048,
    'fast'
FROM llm_providers p WHERE p.name = 'coze' AND NOT EXISTS (
    SELECT 1 FROM llm_models m WHERE m.provider_id = p.id AND m.model_id = 'doubao-seed-2-0-lite-260215'
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
    'doubao-seed-2-0-pro-260215',
    'Doubao Seed 2.0 Pro',
    '多模态旗舰，支持图片理解',
    'vision',
    8192,
    TRUE,
    TRUE,
    TRUE,
    0.7,
    4096,
    'quality'
FROM llm_providers p WHERE p.name = 'coze' AND NOT EXISTS (
    SELECT 1 FROM llm_models m WHERE m.provider_id = p.id AND m.model_id = 'doubao-seed-2-0-pro-260215'
);

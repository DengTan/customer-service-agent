-- Content Security Filter Tables
-- Migration: 20260726_content_security_filter.sql

-- 敏感词表
CREATE TABLE IF NOT EXISTS content_sensitive_words (
    id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    word varchar(100) NOT NULL UNIQUE,
    match_mode varchar(20) NOT NULL DEFAULT 'exact',
    action varchar(20) NOT NULL DEFAULT 'block',
    replacement varchar(100),
    category varchar(50) DEFAULT '脏话',
    is_enabled boolean NOT NULL DEFAULT true,
    hit_count integer NOT NULL DEFAULT 0,
    created_by varchar(36),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS csw_word_idx ON content_sensitive_words(word);
CREATE INDEX IF NOT EXISTS csw_category_idx ON content_sensitive_words(category);
CREATE INDEX IF NOT EXISTS csw_is_enabled_idx ON content_sensitive_words(is_enabled);

-- 域名白名单表
CREATE TABLE IF NOT EXISTS allowed_domains (
    id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    domain varchar(255) NOT NULL UNIQUE,
    pattern_type varchar(20) NOT NULL DEFAULT 'exact',
    description varchar(255),
    is_enabled boolean NOT NULL DEFAULT true,
    hit_count integer NOT NULL DEFAULT 0,
    created_by varchar(36),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_domain_idx ON allowed_domains(domain);
CREATE INDEX IF NOT EXISTS ad_is_enabled_idx ON allowed_domains(is_enabled);

-- 过滤日志表
CREATE TABLE IF NOT EXISTS content_filter_logs (
    id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id varchar(36),
    message_id varchar(36),
    filter_type varchar(20) NOT NULL,
    word varchar(100),
    action varchar(20) NOT NULL,
    original_content text NOT NULL,
    filtered_content text,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cfl_conversation_id_idx ON content_filter_logs(conversation_id);
CREATE INDEX IF NOT EXISTS cfl_filter_type_idx ON content_filter_logs(filter_type);
CREATE INDEX IF NOT EXISTS cfl_created_at_idx ON content_filter_logs(created_at);

-- 添加内容安全相关设置项
INSERT INTO settings (key, value) VALUES
    ('content_filter_enabled', 'true'),
    ('sensitive_word_filter_enabled', 'true'),
    ('url_filter_enabled', 'true'),
    ('url_filter_mode', 'whitelist'),
    ('sensitive_word_default_action', 'block'),
    ('sensitive_word_block_message', '您的消息包含不合规内容，请修改后再试。'),
    ('sensitive_word_warn_message', '提示：消息中包含可能不合适的敏感词'),
    ('url_block_message', '抱歉,发送的链接不在白名单范围内')
ON CONFLICT (key) DO NOTHING;

-- 创建 RPC 函数用于增加敏感词命中计数
CREATE OR REPLACE FUNCTION increment_hit_count(
    table_name TEXT,
    row_word TEXT
) RETURNS VOID AS $$
BEGIN
    IF table_name = 'content_sensitive_words' THEN
        UPDATE content_sensitive_words
        SET hit_count = hit_count + 1
        WHERE word = row_word;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建 RPC 函数用于增加域名命中计数
CREATE OR REPLACE FUNCTION increment_domain_hit_count(
    row_domain TEXT
) RETURNS VOID AS $$
BEGIN
    UPDATE allowed_domains
    SET hit_count = hit_count + 1
    WHERE domain = row_domain;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建 RPC 函数用于获取当前命中计数（用于 fallback）
CREATE OR REPLACE FUNCTION get_hit_count(
    target_table TEXT,
    target_word TEXT
) RETURNS INTEGER AS $$
DECLARE
    current_count INTEGER;
BEGIN
    IF target_table = 'content_sensitive_words' THEN
        SELECT hit_count INTO current_count FROM content_sensitive_words WHERE word = target_word;
    ELSIF target_table = 'allowed_domains' THEN
        SELECT hit_count INTO current_count FROM allowed_domains WHERE domain = target_word;
    END IF;
    RETURN COALESCE(current_count, 0) + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

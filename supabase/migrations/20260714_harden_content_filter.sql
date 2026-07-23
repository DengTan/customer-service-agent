-- Harden content filter RPCs and tables
-- Migration: 20260714_harden_content_filter.sql
--
-- Fixes:
--   1. Pin search_path in increment_hit_count/get_hit_count/increment_domain_hit_count
--      to prevent search_path injection (CONTENT_SCR-001)
--   2. Add RLS to content filter tables
--   3. Add service_role EXECUTE grants so service_role bypass works correctly

-- =============================================================================
-- 1. Pin search_path in content filter RPC functions
-- =============================================================================

-- Harden: increment_hit_count
CREATE OR REPLACE FUNCTION increment_hit_count(
    table_name TEXT,
    row_word TEXT
) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('search_path', '', false);
    IF table_name = 'content_sensitive_words' THEN
        UPDATE content_sensitive_words
        SET hit_count = hit_count + 1
        WHERE word = row_word;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Harden: get_hit_count
CREATE OR REPLACE FUNCTION get_hit_count(
    target_table TEXT,
    target_word TEXT
) RETURNS INTEGER AS $$
DECLARE
    current_count INTEGER;
BEGIN
    PERFORM set_config('search_path', '', false);
    IF target_table = 'content_sensitive_words' THEN
        SELECT hit_count INTO current_count FROM content_sensitive_words WHERE word = target_word;
    ELSIF target_table = 'allowed_domains' THEN
        SELECT hit_count INTO current_count FROM allowed_domains WHERE domain = target_word;
    END IF;
    RETURN COALESCE(current_count, 0) + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Harden: increment_domain_hit_count
CREATE OR REPLACE FUNCTION increment_domain_hit_count(
    row_domain TEXT
) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('search_path', '', false);
    UPDATE allowed_domains
    SET hit_count = hit_count + 1
    WHERE domain = row_domain;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 2. Enable RLS on content filter tables
--    service_role bypasses RLS automatically, so this only restricts anon/public
-- =============================================================================

ALTER TABLE content_sensitive_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE allowed_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_filter_logs ENABLE ROW LEVEL SECURITY;

-- Full access for service_role (bypasses RLS but needs explicit grant for SECURITY DEFINER functions)
CREATE POLICY content_sensitive_words_service_role ON content_sensitive_words
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY allowed_domains_service_role ON allowed_domains
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY content_filter_logs_service_role ON content_filter_logs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 3. Grant EXECUTE to service_role for SECURITY DEFINER RPC functions
-- =============================================================================

GRANT EXECUTE ON FUNCTION increment_hit_count(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_hit_count(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION increment_domain_hit_count(TEXT) TO service_role;

-- =============================================================================
-- 4. Revoke default public access
-- =============================================================================

REVOKE ALL ON content_sensitive_words FROM PUBLIC;
REVOKE ALL ON allowed_domains FROM PUBLIC;
REVOKE ALL ON content_filter_logs FROM PUBLIC;

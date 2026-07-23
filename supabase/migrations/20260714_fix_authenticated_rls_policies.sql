-- Migration: 20260714_fix_authenticated_rls_policies.sql
-- Fix high-risk RLS policies that grant authenticated users full access
-- Created: 2026-07-14

BEGIN;

-- =============================================================================
-- 1. LLM Configuration Protection (HIGH RISK)
-- Change llm_models policies from 'authenticated' to 'service_role' only
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can read models" ON llm_models;
DROP POLICY IF EXISTS "Authenticated users can insert models" ON llm_models;
DROP POLICY IF EXISTS "Authenticated users can update models" ON llm_models;
DROP POLICY IF EXISTS "Authenticated users can delete models" ON llm_models;

CREATE POLICY "Service role can read models"
  ON llm_models FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert models"
  ON llm_models FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update models"
  ON llm_models FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role can delete models"
  ON llm_models FOR DELETE
  TO service_role
  USING (true);

-- =============================================================================
-- 2. LLM Providers Protection (HIGH RISK)
-- Change llm_providers policies from 'authenticated' to 'service_role' only
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can read providers" ON llm_providers;
DROP POLICY IF EXISTS "Authenticated users can insert providers" ON llm_providers;
DROP POLICY IF EXISTS "Authenticated users can update providers" ON llm_providers;
DROP POLICY IF EXISTS "Authenticated users can delete providers" ON llm_providers;

CREATE POLICY "Service role can read providers"
  ON llm_providers FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert providers"
  ON llm_providers FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update providers"
  ON llm_providers FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role can delete providers"
  ON llm_providers FOR DELETE
  TO service_role
  USING (true);

-- =============================================================================
-- 3. Knowledge Base Tables - Change to service_role only
-- These tables contain sensitive knowledge content that should not be
-- readable by all authenticated users
-- =============================================================================

-- knowledge_chunks
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_chunks" ON knowledge_chunks;
CREATE POLICY "Service role can read knowledge_chunks"
  ON knowledge_chunks FOR SELECT
  TO service_role
  USING (true);

-- knowledge_items
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_items" ON knowledge_items;
CREATE POLICY "Service role can read knowledge_items"
  ON knowledge_items FOR SELECT
  TO service_role
  USING (true);

-- knowledge_versions
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_versions" ON knowledge_versions;
CREATE POLICY "Service role can read knowledge_versions"
  ON knowledge_versions FOR SELECT
  TO service_role
  USING (true);

-- knowledge_import_jobs
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_import_jobs" ON knowledge_import_jobs;
CREATE POLICY "Service role can read knowledge_import_jobs"
  ON knowledge_import_jobs FOR SELECT
  TO service_role
  USING (true);

-- knowledge_feedback
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_feedback" ON knowledge_feedback;
CREATE POLICY "Service role can read knowledge_feedback"
  ON knowledge_feedback FOR SELECT
  TO service_role
  USING (true);

-- knowledge_gap_signals
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_gap_signals" ON knowledge_gap_signals;
CREATE POLICY "Service role can read knowledge_gap_signals"
  ON knowledge_gap_signals FOR SELECT
  TO service_role
  USING (true);

-- knowledge_learning_queue
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_learning_queue" ON knowledge_learning_queue;
CREATE POLICY "Service role can read knowledge_learning_queue"
  ON knowledge_learning_queue FOR SELECT
  TO service_role
  USING (true);

-- =============================================================================
-- 4. SECURITY DEFINER Function Hardening (P0)
-- These functions from 20260726_content_security_filter.sql need
-- search_path pinning and EXECUTE revocation from PUBLIC
-- NOTE: This migration should be applied BEFORE 20260726 migration
-- =============================================================================

-- increment_hit_count
CREATE OR REPLACE FUNCTION increment_hit_count(p_content_type TEXT, p_content_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE knowledge_items
  SET hit_count = hit_count + 1,
      last_hit_at = NOW()
  WHERE id = p_content_id
    AND type = p_content_type
  RETURNING hit_count INTO v_count;

  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION increment_hit_count(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_hit_count(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION increment_hit_count(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_hit_count(TEXT, TEXT) TO service_role;

-- increment_domain_hit_count
CREATE OR REPLACE FUNCTION increment_domain_hit_count(p_domain TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE allowed_domains
  SET hit_count = hit_count + 1,
      last_hit_at = NOW()
  WHERE domain = p_domain
  RETURNING hit_count INTO v_count;

  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION increment_domain_hit_count(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_domain_hit_count(TEXT) FROM anon;
REVOKE ALL ON FUNCTION increment_domain_hit_count(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_domain_hit_count(TEXT) TO service_role;

-- get_hit_count
CREATE OR REPLACE FUNCTION get_hit_count(p_content_type TEXT, p_content_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT hit_count INTO v_count
  FROM knowledge_items
  WHERE id = p_content_id AND type = p_content_type;

  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION get_hit_count(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_hit_count(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION get_hit_count(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_hit_count(TEXT, TEXT) TO service_role;

-- =============================================================================
-- 5. Verify all policies are correctly set
-- =============================================================================

-- Ensure no remaining authenticated policies on sensitive tables
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Check llm_models
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'llm_models' AND roles = 'authenticated';
  
  IF v_count > 0 THEN
    RAISE WARNING 'llm_models still has % authenticated policies', v_count;
  END IF;

  -- Check llm_providers
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'llm_providers' AND roles = 'authenticated';
  
  IF v_count > 0 THEN
    RAISE WARNING 'llm_providers still has % authenticated policies', v_count;
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- ROLLBACK SCRIPT (if needed)
-- To rollback these changes, run the following:
--
-- BEGIN;
-- -- Restore llm_models policies (from 20260702_llm_providers_rls.sql)
-- CREATE POLICY "Authenticated users can read models" ON llm_models FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Authenticated users can insert models" ON llm_models FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "Authenticated users can update models" ON llm_models FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "Authenticated users can delete models" ON llm_models FOR DELETE TO authenticated USING (true);
--
-- -- Restore llm_providers policies (from 20260702_llm_providers_rls.sql)
-- CREATE POLICY "Authenticated users can read providers" ON llm_providers FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Authenticated users can insert providers" ON llm_providers FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "Authenticated users can update providers" ON llm_providers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "Authenticated users can delete providers" ON llm_providers FOR DELETE TO authenticated USING (true);
--
-- -- Restore knowledge tables policies (from 20260703_knowledge_rls.sql)
-- CREATE POLICY "Allow authenticated users to read knowledge_chunks" ON knowledge_chunks FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read knowledge_items" ON knowledge_items FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read knowledge_versions" ON knowledge_versions FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read knowledge_import_jobs" ON knowledge_import_jobs FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read knowledge_feedback" ON knowledge_feedback FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read knowledge_gap_signals" ON knowledge_gap_signals FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read knowledge_learning_queue" ON knowledge_learning_queue FOR SELECT TO authenticated USING (true);
-- COMMIT;
-- =============================================================================

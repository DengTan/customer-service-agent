-- Migration: 20260715_fix_llm_rls_for_anon.sql
-- Fix RLS policies for llm_models and llm_providers to allow anon role SELECT
-- Created: 2026-07-15
--
-- Problem: The 20260714_fix_authenticated_rls_policies migration locked down
-- llm_models and llm_providers to service_role only, breaking frontend access.
-- Frontend uses SUPABASE_ANON_KEY (anon role) to query these tables.
--
-- Solution: Add anon SELECT policy while keeping service_role for write operations.

BEGIN;

-- =============================================================================
-- 1. LLM Models - Add anon SELECT policy
-- =============================================================================

-- Drop existing service_role only policies
DROP POLICY IF EXISTS "Service role can read models" ON llm_models;
DROP POLICY IF EXISTS "Service role can insert models" ON llm_models;
DROP POLICY IF EXISTS "Service role can update models" ON llm_models;
DROP POLICY IF EXISTS "Service role can delete models" ON llm_models;

-- Add anon SELECT policy (for frontend read access)
CREATE POLICY "Anon can read models"
  ON llm_models FOR SELECT
  TO anon
  USING (true);

-- Keep service_role for write operations
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
-- 2. LLM Providers - Add anon SELECT policy
-- =============================================================================

-- Drop existing service_role only policies
DROP POLICY IF EXISTS "Service role can read providers" ON llm_providers;
DROP POLICY IF EXISTS "Service role can insert providers" ON llm_providers;
DROP POLICY IF EXISTS "Service role can update providers" ON llm_providers;
DROP POLICY IF EXISTS "Service role can delete providers" ON llm_providers;

-- Add anon SELECT policy (for frontend read access)
CREATE POLICY "Anon can read providers"
  ON llm_providers FOR SELECT
  TO anon
  USING (true);

-- Keep service_role for write operations
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
-- 3. Verify policies are correctly set
-- =============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Check llm_models has anon SELECT policy
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'llm_models' AND policyname = 'Anon can read models';
  
  IF v_count = 0 THEN
    RAISE WARNING 'llm_models missing anon SELECT policy!';
  ELSE
    RAISE NOTICE 'llm_models anon SELECT policy verified';
  END IF;

  -- Check llm_providers has anon SELECT policy
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'llm_providers' AND policyname = 'Anon can read providers';
  
  IF v_count = 0 THEN
    RAISE WARNING 'llm_providers missing anon SELECT policy!';
  ELSE
    RAISE NOTICE 'llm_providers anon SELECT policy verified';
  END IF;
END;
$$;

COMMIT;

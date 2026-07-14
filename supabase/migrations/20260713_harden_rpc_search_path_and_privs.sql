-- =============================================================================
-- Migration: 20260713_harden_rpc_search_path_and_privs.sql
-- Date: 2026-07-13
-- Author: Cursor AI (SmartAssist DB Security Engineer)
-- Purpose: Harden all public RPC functions for search_path and EXECUTE privileges.
--
-- BACKGROUND & FINDINGS:
-- 1. Application uses SUPABASE_SERVICE_ROLE_KEY for all server-side RPC calls
--    (see src/storage/database/supabase-client.ts getSupabaseClient()).
--    Therefore REVOKE from anon/authenticated is safe for SECURITY DEFINER functions.
--
-- 2. rls_auto_enable() is a Supabase platform-managed event trigger function.
--    Modifying it risks Supabase platform instability. DO NOT ALTER. Document only.
--
-- 3. exec() RPC does NOT exist in any remote schema. The admin/migrate/route.ts
--    calls supabase.rpc('exec', {...}) which always fails silently. This is dead
--    code; the tables it tries to create (content_sensitive_words, etc.) are
--    not present in remote. The companion migration 20260726_content_security_filter.sql
--    also never ran. Fix requires separate task: create the exec() function or
--    replace the migration endpoint with apply_migration approach.
--
-- 4. The migration 20260726_content_security_filter.sql defines three functions
--    (increment_hit_count, increment_domain_hit_count, get_hit_count) that are
--    NOT present in the remote database. This migration has NOT been applied.
--    If applied in future: must add search_path + revoke anon/authenticated.
--
-- 5. Settings-related functions (upsert_settings_batch, seed_system_defaults,
--    try_acquire_settings_seed_lock, upsert_many_settings, reset_settings_to_defaults)
--    are in scope of a parallel "设置契约" task that may CREATE OR REPLACE them.
--    Per task boundary rules, we only add idempotent SET search_path to those that
--    currently lack it; we do NOT modify function bodies. The idempotent ALTER
--    will survive a CREATE OR REPLACE that omits SET search_path (PostgreSQL
--    preserves SET options on function replacement).
--
-- SAFETY: All ALTER FUNCTION statements use exact argument signatures (pronargs)
--         and are idempotent. REVOKE is a no-op if already revoked.
-- =============================================================================

-- =============================================================================
-- PHASE 1: SECURITY DEFINER functions — highest risk
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function: upsert_bot_config
-- OID: 18951 | Owner: postgres | Args: 15 (p_id text, p_name text, ...)
-- Current state: SECURITY DEFINER, search_path=NULL, anon/authenticated/service_role all have EXECUTE
-- Risk: CRITICAL — SECURITY DEFINER without search_path can be path-hijacked.
--        anon can call this function and gain postgres-level privileges.
-- Action:
--   1. SET search_path = pg_catalog, public (prevents function-body hijacking)
--   2. REVOKE EXECUTE FROM anon, authenticated, PUBLIC
--      (service_role and postgres remain; application uses service_role key)
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.upsert_bot_config(
  p_id text,
  p_name text,
  p_description text,
  p_system_prompt text,
  p_tools jsonb,
  p_knowledge_ids jsonb,
  p_skill_group_id text,
  p_is_default boolean,
  p_parent_bot_id text,
  p_delegation_prompt text,
  p_collaboration_config jsonb,
  p_is_sub_agent boolean,
  p_status text,
  p_platform_connection_id text,
  p_expected_updated_at text
) SET search_path = pg_catalog, public;

-- Revoke PUBLIC (implicit grant) first, then explicit anon/authenticated grants
REVOKE EXECUTE ON FUNCTION public.upsert_bot_config(
  p_id text, p_name text, p_description text, p_system_prompt text,
  p_tools jsonb, p_knowledge_ids jsonb, p_skill_group_id text,
  p_is_default boolean, p_parent_bot_id text, p_delegation_prompt text,
  p_collaboration_config jsonb, p_is_sub_agent boolean, p_status text,
  p_platform_connection_id text, p_expected_updated_at text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.upsert_bot_config(
  p_id text, p_name text, p_description text, p_system_prompt text,
  p_tools jsonb, p_knowledge_ids jsonb, p_skill_group_id text,
  p_is_default boolean, p_parent_bot_id text, p_delegation_prompt text,
  p_collaboration_config jsonb, p_is_sub_agent boolean, p_status text,
  p_platform_connection_id text, p_expected_updated_at text
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.upsert_bot_config(
  p_id text, p_name text, p_description text, p_system_prompt text,
  p_tools jsonb, p_knowledge_ids jsonb, p_skill_group_id text,
  p_is_default boolean, p_parent_bot_id text, p_delegation_prompt text,
  p_collaboration_config jsonb, p_is_sub_agent boolean, p_status text,
  p_platform_connection_id text, p_expected_updated_at text
) FROM authenticated;

-- -----------------------------------------------------------------------------
-- Function: upsert_settings_batch
-- OID: 19617 | Owner: postgres | Args: 1 (p_items jsonb)
-- Current state: SECURITY DEFINER, search_path={search_path=pg_catalog, public}, anon/authenticated NOT granted (service_role has EXECUTE)
-- Risk: LOW — search_path already set, no anon/authenticated EXECUTE. Confirm only.
-- Action: Already correct; add idempotent search_path to ensure durability on future CREATE OR REPLACE.
-- Note: This function is in scope of parallel "设置契约" task. Adding SET here
--       survives CREATE OR REPLACE and does not conflict with body changes.
-- -----------------------------------------------------------------------------

-- Idempotent: PostgreSQL SET clause on function replacement is not overwritten by
-- CREATE OR REPLACE unless the replacement explicitly specifies SET search_path.
-- Adding it again is a no-op if already present.

ALTER FUNCTION public.upsert_settings_batch(p_items jsonb)
  SET search_path = pg_catalog, public;

-- Confirm anon/authenticated are not present (idempotent revoke; no-op if already revoked)
REVOKE EXECUTE ON FUNCTION public.upsert_settings_batch(p_items jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_settings_batch(p_items jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_settings_batch(p_items jsonb) FROM authenticated;

-- -----------------------------------------------------------------------------
-- Function: rotate_push_webhook_secret
-- OID: 19618 | Owner: postgres | Args: 1 (p_new_value text)
-- Current state: SECURITY DEFINER, search_path={search_path=pg_catalog, public}, anon/authenticated NOT granted
-- Risk: LOW — already hardened. Confirm only.
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.rotate_push_webhook_secret(p_new_value text)
  SET search_path = pg_catalog, public;

REVOKE EXECUTE ON FUNCTION public.rotate_push_webhook_secret(p_new_value text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rotate_push_webhook_secret(p_new_value text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rotate_push_webhook_secret(p_new_value text) FROM authenticated;

-- =============================================================================
-- PHASE 2: SECURITY INVOKER functions missing search_path
-- (Advisors: function_search_path_mutable — WEAK security issue)
-- =============================================================================

-- Helper note: PostgreSQL SET search_path on SECURITY INVOKER functions prevents
-- search_path hijacking if the function body omits explicit schema prefixes.
-- These functions are called internally by the application via service_role key.

-- -----------------------------------------------------------------------------
-- Function: enforce_main_bot_cap (trigger function, 0 args)
-- OID: 19516 | Owner: postgres | Returns: trigger
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.enforce_main_bot_cap() SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Function: enforce_sub_agent_cap (trigger function, 0 args)
-- OID: 19083 | Owner: postgres | Returns: trigger
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.enforce_sub_agent_cap() SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Function: increment_customer_conversation_count (1 arg)
-- OID: 19494 | Owner: postgres | Returns: void
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.increment_customer_conversation_count(p_customer_id uuid)
  SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Function: increment_message_count_by (2 args)
-- OID: 18569 | Owner: postgres | Returns: void
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.increment_message_count_by(conv_id varchar, delta integer)
  SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Function: increment_simulation_message_count (1 arg)
-- OID: 18570 | Owner: postgres | Returns: void
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.increment_simulation_message_count(conv_id varchar)
  SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Function: match_knowledge_items (3 args)
-- OID: 19630 | Owner: postgres | Returns: TABLE(...)
-- Note: Uses vector type (pg_vector extension). Search path ensures correct type resolution.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.match_knowledge_items(
  p_query_embedding vector,
  p_match_threshold float8,
  p_match_count integer
) SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Function: match_product_details (3 args)
-- OID: 19455 | Owner: postgres | Returns: TABLE(...)
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.match_product_details(
  p_query_embedding vector,
  p_match_threshold float8,
  p_match_count integer
) SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Function: match_size_charts (3 args)
-- OID: 19456 | Owner: postgres | Returns: TABLE(...)
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.match_size_charts(
  p_query_embedding vector,
  p_match_threshold float8,
  p_match_count integer
) SET search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- Settings-related functions (in parallel task scope — idempotent SET only)
-- These may be CREATE OR REPLACE'd by the "设置契约" task; the SET clause
-- survives that operation and ensures durability.
-- -----------------------------------------------------------------------------

-- Function: seed_system_defaults (1 arg, jsonb)
-- OID: 19519 | Owner: postgres | Returns: integer
-- Note: Settings-related; idempotent SET search_path added.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.seed_system_defaults(p_defaults jsonb)
  SET search_path = pg_catalog, public;

-- Function: try_acquire_settings_seed_lock (0 args)
-- OID: 19518 | Owner: postgres | Returns: boolean
-- Note: Settings-related; idempotent SET search_path added.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.try_acquire_settings_seed_lock()
  SET search_path = pg_catalog, public;

-- Function: try_acquire_webhook_event (3 args)
-- OID: 18571 | Owner: postgres | Returns: boolean
-- Note: Webhook-related; idempotent SET search_path added.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.try_acquire_webhook_event(
  p_event_id varchar,
  p_event_type varchar,
  p_object_id varchar
) SET search_path = pg_catalog, public;

-- =============================================================================
-- PHASE 3: Document-only (DO NOT ALTER)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rls_auto_enable()
-- OID: 17588 | Owner: postgres | Returns: event_trigger
-- Type: Supabase platform-managed event trigger function
-- search_path={search_path=pg_catalog}
-- proacl: postgres=X, anon=X, authenticated=X, service_role=X (all explicit)
-- Risk if altered: Supabase platform may fail to apply RLS correctly.
-- Decision: DO NOT MODIFY. Document in security report.
-- Recommendation: Contact Supabase support before considering any changes.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- PHASE 4: Remote-missing functions (local migration 20260726 not applied)
-- Document for future application
-- =============================================================================

-- The following functions are defined in local migration
-- 20260726_content_security_filter.sql but are NOT present in the remote
-- database (migration has not been applied). If applied in future:
--
--   CREATE OR REPLACE FUNCTION public.increment_hit_count(table_name TEXT, row_word TEXT)
--     RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path = pg_catalog, public;
--     -- REVOKE EXECUTE FROM PUBLIC, anon, authenticated;
--
--   CREATE OR REPLACE FUNCTION public.increment_domain_hit_count(row_domain TEXT)
--     RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path = pg_catalog, public;
--     -- REVOKE EXECUTE FROM PUBLIC, anon, authenticated;
--
--   CREATE OR REPLACE FUNCTION public.get_hit_count(target_table TEXT, target_word TEXT)
--     RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path = pg_catalog, public;
--     -- REVOKE EXECUTE FROM PUBLIC, anon, authenticated;
--
-- =============================================================================

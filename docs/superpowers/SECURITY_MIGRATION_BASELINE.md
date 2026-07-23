# SmartAssist Security Migration Baseline

**Project:** SmartAssist (customer_service_agent)
**Supabase Project:** `avmregjnnsmshwxrwjie`
**Document Version:** 2026-07-14
**Status:** Living document — update after each migration application

---

## Purpose

This document records the canonical state of applied database migrations as of Phase 7 of the security hardening work. It serves as:

1. **Remote migration history** — confirmed applied migrations via `list_migrations`
2. **Local-only migrations** — migrations present locally but not applied to remote
3. **Known gaps** — tables or functions that should be hardened but are not yet

---

## Remote Applied Migrations (Confirmed via `list_migrations`)

The following migrations have been confirmed applied to the remote Supabase database:

| Version | Name | Applied At | Purpose |
|---------|------|-----------|---------|
| `20260713070608` | `rag_chunk_identity_drop_and_recreate` | 2026-07-13 | Fix chunk identity for RAG |
| `20260713070837` | `rag_chunk_identity_fix_name_cast` | 2026-07-13 | Fix name cast in chunk identity |
| `20260714024842` | `create_retrieval_traces_table` | 2026-07-14 | Create retrieval_traces table for provenance tracking |
| `20260714025526` | `fix_settings_seed_reset_role_guard` | 2026-07-14 | Fix inner-guard in seed/reset RPCs using `current_setting('role')` |
| `20260714033927` | `p3_phase2_provenance_v1_backfill` | 2026-07-14 | Mark existing retrieval_traces as synthetic_v1_backfill |
| `20260714034607` | `claim_attestations` | 2026-07-14 | Provenance governance Phase 1 |
| `20260714035933` | `20260714_fix_authenticated_rls_policies` | 2026-07-14 | Change llm_models/llm_providers/knowledge policies to service_role only |

---

## Applied Security Hardening Migrations

The following security-specific migrations are included in the applied set above:

### RLS Enablement (implicit — via platform or prior migrations)

- **RLS status:** 60 tables have RLS enabled (per `20260713_enable_rls_batches.sql`)
- **Object grants:** All 60 tables have `REVOKE ALL FROM anon, authenticated`
- **Key policies:** `settings_deny_all_anon`, `settings_deny_all_authenticated`, `llm_models` service_role only, `llm_providers` service_role only, content_filter tables service_role only

### RPC Hardening (via `20260713_harden_rpc_search_path_and_privs.sql`)

Functions with `SET search_path = pg_catalog, public`:

| Function | Type | Risk |
|----------|------|------|
| `upsert_bot_config` | SECURITY DEFINER | CRITICAL — path hijacking prevention |
| `upsert_settings_batch` | SECURITY DEFINER | Already hardened — idempotent SET |
| `rotate_push_webhook_secret` | SECURITY DEFINER | Already hardened — idempotent SET |
| `enforce_main_bot_cap` | SECURITY INVOKER | WEAK — path hygiene |
| `enforce_sub_agent_cap` | SECURITY INVOKER | WEAK — path hygiene |
| `increment_customer_conversation_count` | SECURITY INVOKER | WEAK — path hygiene |
| `increment_message_count_by` | SECURITY INVOKER | WEAK — path hygiene |
| `increment_simulation_message_count` | SECURITY INVOKER | WEAK — path hygiene |
| `match_knowledge_items` | SECURITY INVOKER | WEAK — pg_vector type resolution |
| `match_product_details` | SECURITY INVOKER | WEAK — pg_vector type resolution |
| `match_size_charts` | SECURITY INVOKER | WEAK — pg_vector type resolution |
| `seed_system_defaults` | SECURITY DEFINER | Fixed by `fix_settings_seed_reset_role_guard` |
| `try_acquire_settings_seed_lock` | SECURITY INVOKER | WEAK — path hygiene |
| `reset_settings_to_defaults` | SECURITY DEFINER | Fixed by `fix_settings_seed_reset_role_guard` |
| `try_acquire_webhook_event` | SECURITY INVOKER | WEAK — path hygiene |

### Content Filter Hardening (via `20260714_harden_content_filter.sql`)

Functions with `SECURITY DEFINER` + `PERFORM set_config('search_path', '', false)` in body:

- `increment_hit_count`
- `get_hit_count`
- `increment_domain_hit_count`

Tables with RLS + service_role policy:

- `content_sensitive_words`
- `allowed_domains`
- `content_filter_logs`

---

## Local-Only Migrations (Not Applied to Remote)

These migrations exist locally but have **not** been applied to the remote database:

| Migration | Date | Reason Not Applied | Risk |
|----------|------|-------------------|------|
| `20260715_add_bot_platform_connection.sql` | 2026-07-15 | Future date — intentionally uncommitted | Low |
| `20260726_content_security_filter.sql` | 2026-07-26 | Never applied; superseded by `20260714_harden_content_filter.sql` | See SR-005 |
| `20260728_bot_update_rpc.sql` | 2026-07-28 | Future date — intentionally uncommitted | Low |

### Decision: Do Not Back-Date or Replay Historical Migrations

As of 2026-07-14, the following principle is established:

> **Do not back-date migration files to today's date or replay migrations with dates in the past.** All migration files must have a date ≤ today's date at the time of creation. Previously created future-dated files (like `20260726_content_security_filter.sql`) are preserved for reference but will not be applied retroactively.

This is documented in `scripts/check-rls-state.ts` as a static check.

---

## Known Gaps

### Gap 1: `retrieval_traces` Missing from RLS Batch

**Description:** `retrieval_traces` was created by `20260713_retrieval_traces.sql` but is not included in `20260713_enable_rls_batches.sql`. As a result, it was created without RLS and was not subsequently hardened.

**Impact:** Low — the table is internal to the provenance system.

**Status:** Open — requires a follow-up migration to enable RLS on `retrieval_traces`.

**Reference:** `scripts/check-rls-state.ts` whitelist entry `20260713_retrieval_traces.sql`.

### Gap 2: `increment_hit_count` / `get_hit_count` / `increment_domain_hit_count` — Two Versions Exist

**Description:** Two definitions of these functions exist:
1. **Local unapplied:** `20260726_content_security_filter.sql` — uses `PERFORM set_config('search_path', '', false)` in body
2. **Remote applied:** `20260714_fix_authenticated_rls_policies.sql` — creates them as standalone functions without `SET search_path = pg_catalog, public` in the function signature

The remote version in `20260714_fix_authenticated_rls_policies.sql` does NOT have `SET search_path = pg_catalog, public` in the `CREATE OR REPLACE FUNCTION` header. Instead, it relies on the `PERFORM set_config('search_path', '', false)` pattern within the body.

**Decision:** The remote version is accepted as-is because `set_config('search_path', '', false)` clears the search_path within the function body. This is a valid alternative to `SET search_path` in the function signature. The `20260713_harden_rpc_search_path_and_privs.sql` did not touch these functions because they weren't in remote at that time.

---

## Database Table RLS Status (60 + 3 pre-existing)

### Batch 1 — Highest Risk (Credentials & Auth)

| Table | RLS | REVOKE | Notes |
|-------|-----|--------|-------|
| `users` | ✅ | ✅ anon/auth | |
| `shop_agent_accounts` | ✅ | ✅ anon/auth | |
| `login_events` | ✅ | ✅ anon/auth | |
| `llm_providers` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `platform_connections` | ✅ | ✅ anon/auth | |
| `role_permissions` | ✅ | ✅ anon/auth | |

### Batch 2 — High Risk (Conversations & Customer Privacy)

| Table | RLS | REVOKE | Notes |
|-------|-----|--------|-------|
| `messages` | ✅ | ✅ anon/auth | |
| `conversations` | ✅ | ✅ anon/auth | |
| `customers` | ✅ | ✅ anon/auth | |
| `customer_conversations` | ✅ | ✅ anon/auth | |
| `agent_sessions` | ✅ | ✅ anon/auth | |
| `agent_queue` | ✅ | ✅ anon/auth | |
| `shop_agent_bindings` | ✅ | ✅ anon/auth | |

### Batch 3 — Medium Risk (Business Logic & Operations)

| Table | RLS | REVOKE | Notes |
|-------|-----|--------|-------|
| `bot_configs` | ✅ | ✅ anon/auth | |
| `routing_rules` | ✅ | ✅ anon/auth | |
| `auto_reply_rules` | ✅ | ✅ anon/auth | |
| `quick_replies` | ✅ | ✅ anon/auth | |
| `skill_groups` | ✅ | ✅ anon/auth | |
| `schedules` | ✅ | ✅ anon/auth | |
| `alerts` | ✅ | ✅ anon/auth | |
| `agent_assignment_config` | ✅ | ✅ anon/auth | |
| `agent_assignment_stats` | ✅ | ✅ anon/auth | |
| `tickets` | ✅ | ✅ anon/auth | |
| `ticket_comments` | ✅ | ✅ anon/auth | |
| `ticket_status_log` | ✅ | ✅ anon/auth | |
| `conversation_tags_def` | ✅ | ✅ anon/auth | |
| `conversation_tag_records` | ✅ | ✅ anon/auth | |
| `customer_tags` | ✅ | ✅ anon/auth | |
| `quality_rules` | ✅ | ✅ anon/auth | |
| `quality_checks` | ✅ | ✅ anon/auth | |
| `agent_collaborations` | ✅ | ✅ anon/auth | |
| `agent_delegations` | ✅ | ✅ anon/auth | |

### Batch 4 — Low Risk (Content Assets / Stats / Logs)

| Table | RLS | REVOKE | Notes |
|-------|-----|--------|-------|
| `knowledge_items` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `knowledge_chunks` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `knowledge_versions` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `knowledge_import_jobs` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `knowledge_feedback` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `knowledge_gap_signals` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `knowledge_learning_queue` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `marketing_campaigns` | ✅ | ✅ anon/auth | |
| `marketing_logs` | ✅ | ✅ anon/auth | |
| `push_templates` | ✅ | ✅ anon/auth | |
| `push_records` | ✅ | ✅ anon/auth | |
| `push_event_log` | ✅ | ✅ anon/auth | |
| `product_details` | ✅ | ✅ anon/auth | |
| `size_charts` | ✅ | ✅ anon/auth | |
| `size_chart_versions` | ✅ | ✅ anon/auth | |
| `webhook_event_processed` | ✅ | ✅ anon/auth | |
| `simulation_conversations` | ✅ | ✅ anon/auth | |
| `simulation_messages` | ✅ | ✅ anon/auth | |
| `content_filter_logs` | ✅ | ✅ anon/auth | **service_role policy** |
| `content_sensitive_words` | ✅ | ✅ anon/auth | **service_role policy** |
| `allowed_domains` | ✅ | ✅ anon/auth | **service_role policy** |
| `health_check` | ✅ | ✅ anon/auth | |
| `llm_models` | ✅ | ✅ anon/auth | **Policies: service_role only** |
| `shops` | ✅ | ✅ anon/auth | |

### Pre-existing RLS Tables

| Table | RLS | Notes |
|-------|-----|-------|
| `settings` | ✅ | **Policies: deny-all anon + deny-all authenticated** |
| `simulation_evaluations` | ✅ | |
| `test_cases` | ✅ | |

### Missing from RLS Batch (Gap)

| Table | RLS | Notes |
|-------|-----|-------|
| `retrieval_traces` | ❌ | Created 2026-07-13 but missing from RLS batch — **known gap** |

---

## Platform-Managed Components (Not Under Project Control)

| Component | Type | Status | Risk |
|-----------|------|--------|------|
| `rls_auto_enable()` | Event trigger function | Supabase platform-managed | search_path=pg_catalog; DO NOT MODIFY |
| `vector` extension | Extension | Standard pg_vector | Non-risk; documented in risk register |

---

## Validation Commands

```bash
# Static migration checks (no DB required)
pnpm tsx scripts/check-rls-state.ts

# Remote RLS state (requires SUPABASE_URL + SERVICE_ROLE_KEY)
SUPABASE_URL=https://avmregjnnsmshwxrwjie.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
pnpm tsx scripts/check-rls-state.ts

# Run all tests
pnpm test:run

# TypeScript check
pnpm ts-check
```

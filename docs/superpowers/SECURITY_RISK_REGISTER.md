# SmartAssist Security Risk Register

**Project:** SmartAssist (customer_service_agent)
**Supabase Project:** `avmregjnnsmshwxrwjie`
**Document Version:** 2026-07-14
**Review Cadence:** Monthly or after any migration application

---

## Purpose

This document tracks known security risks in the SmartAssist database configuration, Supabase platform setup, and application code. Each risk has a unique ID, classification, owner, mitigation status, and planned review date.

---

## Risk Entries

### SR-001: `rls_auto_enable()` Platform Function with Non-Standard `search_path`

| Field | Value |
|-------|-------|
| **Risk ID** | SR-001 |
| **Risk Description** | `rls_auto_enable()` is a Supabase platform-managed event trigger function. It has `search_path={search_path=pg_catalog}` (no `public` in the path). If a future migration creates a table without explicit `public.` schema prefix in a SECURITY DEFINER function body, the function could resolve objects in `pg_catalog` incorrectly. |
| **Type** | Platform / External Dependency |
| **Severity** | Low |
| **Owner** | Supabase (platform) |
| **Acceptance Rationale** | Supabase托管平台函数，无法修改配置。supabase=service_role 在 Supabase 托管环境中始终 bypasses RLS。`rls_auto_enable` 仅在新表创建时触发，不直接暴露数据。 |
| **Mitigation** | All project SECURITY DEFINER functions explicitly set `SET search_path = pg_catalog, public` to prevent hijacking. The absence of `public` in `rls_auto_enable()` does not affect project functions that pin their own search_path. |
| **Review Date** | 2026-10-01 |
| **Close Condition** | Supabase publishes official documentation on `rls_auto_enable()` search_path behavior, or a migration pattern is validated that avoids the risk entirely. |
| **Status** | Open (Accepted) |

---

### SR-002: `vector` Extension Located in `public` Schema

| Field | Value |
|-------|-------|
| **Risk ID** | SR-002 |
| **Risk Description** | The `vector` extension (for pg_vector similarity search) is installed in the `public` schema. This is standard pg_vector usage. There are no known CVEs for this configuration in PostgreSQL 15+/pg_vector 0.5+. |
| **Type** | Extension / Non-Risk (Documentation) |
| **Severity** | Informational |
| **Owner** | Project |
| **Acceptance Rationale** | pg_vector 标准用法，无已知安全漏洞。`vector` type requires schema-qualified references in SECURITY DEFINER functions, which is handled by the `SET search_path = pg_catalog, public` pattern used in all hardened RPC functions. |
| **Mitigation** | All match_* RPC functions set `search_path = pg_catalog, public` ensuring correct `vector` type resolution. |
| **Review Date** | 2026-10-01 |
| **Close Condition** | Evaluate whether migrating `vector` to a dedicated schema is warranted for defense-in-depth. |
| **Status** | Informational (Accepted) |

---

### SR-003: `JWT_SECRET` Hardcoded Fallback Default

| Field | Value |
|-------|-------|
| **Risk ID** | SR-003 |
| **Risk Description** | The JWT secret used for token signing has a hardcoded fallback default value (`super-secret-jwt-token-with-at-least-32-characters-long!!`) in `src/lib/auth/jwt.ts`. If this code is deployed to production without the environment variable set, tokens could be signed with a predictable secret. |
| **Type** | Secret Management |
| **Severity** | High (if deployed without env var) |
| **Owner** | Project |
| **Acceptance Rationale** | Development fallback is necessary for local development. Production deployments are expected to set `JWT_SECRET` environment variable. A startup warning is logged when the default is used. |
| **Mitigation** | - `src/lib/auth/jwt.ts` logs a console warning at startup when using the default secret<br>- Production deployments must set `JWT_SECRET` environment variable<br>- Future work: key rotation mechanism |
| **Review Date** | 2026-08-01 |
| **Close Condition** | Key rotation mechanism implemented; default secret removed from production builds. |
| **Status** | Open (Mitigated) |

---

### SR-004: `exec()` RPC Dead Code

| Field | Value |
|-------|-------|
| **Risk ID** | SR-004 |
| **Risk Description** | `src/app/api/admin/migrate/route.ts` calls `supabase.rpc('exec', {...})` to execute arbitrary SQL. This RPC function does not exist in the remote database, so the call always fails silently. This is dead code that should be removed. |
| **Type** | Code Defect |
| **Severity** | Low (dead code, no runtime risk) |
| **Owner** | Project |
| **Acceptance Rationale** | Function does not exist — calling it produces a runtime error that is caught and logged, not a security vulnerability. |
| **Mitigation** | Dead code should be removed. The `apply_migration` approach via Supabase MCP is the recommended replacement for migration execution. |
| **Review Date** | N/A |
| **Close Condition** | `exec()` RPC dead code removed from `admin/migrate/route.ts`. |
| **Status** | Accepted (pending cleanup) |

---

### SR-005: `20260726_content_security_filter.sql` Never Applied

| Field | Value |
|-------|-------|
| **Risk ID** | SR-005 |
| **Risk Description** | Local migration `20260726_content_security_filter.sql` defines `increment_hit_count`, `get_hit_count`, and `increment_domain_hit_count` functions plus three content filter tables. This migration has never been applied to the remote database. The remote version of these functions (from `20260714_fix_authenticated_rls_policies.sql`) has a different implementation using `PERFORM set_config('search_path', '', false)` instead of `SET search_path` in the function signature. |
| **Type** | Missing Feature |
| **Severity** | Low (feature not requested) |
| **Owner** | Project |
| **Acceptance Rationale** | Content filtering is not a P0 feature — user has not requested it. The migration is preserved locally for reference but not applied. |
| **Mitigation** | Remote version of these functions uses `PERFORM set_config('search_path', '', false)` which clears the search_path within the function body — a valid alternative to `SET search_path` in the signature. |
| **Review Date** | 2026-08-01 |
| **Close Condition** | User requests content filtering feature, OR migration is formally archived/removed from the local migrations directory. |
| **Status** | Open (Accepted — Feature Not Requested) |

---

### SR-006: `increment_hit_count` etc. — Remote Functions Without `SET search_path` Signature

| Field | Value |
|-------|-------|
| **Risk ID** | SR-006 |
| **Risk Description** | The remote version of `increment_hit_count`, `get_hit_count`, and `increment_domain_hit_count` (from `20260714_fix_authenticated_rls_policies.sql`) does NOT have `SET search_path = pg_catalog, public` in the `CREATE OR REPLACE FUNCTION` signature. It uses `PERFORM set_config('search_path', '', false)` inside the function body instead. While this is functionally equivalent for the SECURITY DEFINER functions in question, it is less durable than `SET search_path` in the function signature (which survives `CREATE OR REPLACE`). |
| **Type** | Configuration Hardening |
| **Severity** | Medium |
| **Owner** | Project |
| **Acceptance Rationale** | The functions use `PERFORM set_config('search_path', '', false)` which clears search_path within the body. This is functionally equivalent to `SET search_path = pg_catalog, public` for SECURITY DEFINER functions. The pattern is acceptable. However, `CREATE OR REPLACE` would reset the in-body `set_config` call if the function body changes. |
| **Mitigation** | When applying `20260726_content_security_filter.sql` in the future (if needed), ensure the `SET search_path` clause is added to the function signature, not just the body. |
| **Review Date** | 2026-08-01 |
| **Close Condition** | Migration applied with proper `SET search_path` in function signature, OR remote functions are validated as not used by application code. |
| **Status** | Open (Monitoring) |

---

### SR-007: `retrieval_traces` Missing from RLS Batch

| Field | Value |
|-------|-------|
| **Risk ID** | SR-007 |
| **Risk Description** | The `retrieval_traces` table was created by `20260713_retrieval_traces.sql` but was not included in `20260713_enable_rls_batches.sql`. As a result, RLS was not enabled on this table. |
| **Type** | RLS Gap |
| **Severity** | Low (internal provenance table) |
| **Owner** | Project |
| **Acceptance Rationale** | `retrieval_traces` is an internal table used by the provenance governance system. It does not contain customer PII. However, for defense-in-depth, RLS should be enabled. |
| **Mitigation** | Documented in `scripts/check-rls-state.ts` whitelist. Follow-up migration needed: `ALTER TABLE retrieval_traces ENABLE ROW LEVEL SECURITY; CREATE POLICY retrieval_traces_service_role ON retrieval_traces FOR ALL TO service_role USING (true) WITH CHECK (true); REVOKE ALL ON TABLE retrieval_traces FROM anon, authenticated;` |
| **Review Date** | 2026-08-01 |
| **Close Condition** | RLS enabled on `retrieval_traces` via a new migration. |
| **Status** | Open (Remediation Planned) |

---

### SR-008: Multiple Versions of Content Filter Functions

| Field | Value |
|-------|-------|
| **Risk ID** | SR-008 |
| **Risk Description** | Two different definitions of `increment_hit_count`, `get_hit_count`, and `increment_domain_hit_count` exist: (1) local unapplied `20260726_content_security_filter.sql` with `CREATE OR REPLACE ... SET search_path = pg_catalog, public`, and (2) remote applied `20260714_fix_authenticated_rls_policies.sql` with inline `PERFORM set_config('search_path', '', false)`. If the local migration is ever applied without understanding the duplicate, the second `CREATE OR REPLACE` will overwrite the remote function. |
| **Type** | Migration Integrity |
| **Severity** | Medium |
| **Owner** | Project |
| **Acceptance Rationale** | The local migration `20260726_content_security_filter.sql` should be formally archived or deleted to prevent accidental application. |
| **Mitigation** | Decision recorded: `20260726_content_security_filter.sql` will not be applied. Local file preserved for documentation only. When content filtering is eventually implemented, a new clean migration should be created. |
| **Review Date** | 2026-08-01 |
| **Close Condition** | `20260726_content_security_filter.sql` is deleted or formally archived with a `_archived_` prefix. |
| **Status** | Open (Accepted — Will Not Apply) |

---

## Risk Summary Table

| ID | Description | Type | Severity | Owner | Status | Review Date |
|----|-----------|------|---------|-------|--------|------------|
| SR-001 | `rls_auto_enable()` platform search_path | Platform | Low | Supabase | Accepted | 2026-10-01 |
| SR-002 | `vector` in public schema | Informational | Info | Project | Accepted | 2026-10-01 |
| SR-003 | `JWT_SECRET` hardcoded fallback | Secret Mgmt | High | Project | Mitigated | 2026-08-01 |
| SR-004 | `exec()` RPC dead code | Defect | Low | Project | Accepted | N/A |
| SR-005 | `20260726_content_security_filter.sql` unapplied | Missing Feature | Low | Project | Accepted | 2026-08-01 |
| SR-006 | Remote hit_count functions — no search_path signature | Hardening | Medium | Project | Monitoring | 2026-08-01 |
| SR-007 | `retrieval_traces` missing RLS | RLS Gap | Low | Project | Remediation | 2026-08-01 |
| SR-008 | Duplicate content filter function versions | Integrity | Medium | Project | Accepted | 2026-08-01 |

**Open:** 8 | **Closed:** 0 | **Accepted:** 6 | **Mitigated:** 1 | **Monitoring:** 1 | **Remediation Planned:** 1

---

## Severity Definitions

| Level | Description |
|-------|-------------|
| **Critical** | Active exploitation possible; data breach imminent |
| **High** | Significant risk; requires priority remediation |
| **Medium** | Moderate risk; should be addressed in current sprint |
| **Low** | Minor risk; address when capacity allows |
| **Informational** | No risk; documentation only |

---

## Review Log

| Date | Reviewer | Changes |
|------|---------|---------|
| 2026-07-14 | Cursor AI | Initial risk register created as part of Phase 7 security work |

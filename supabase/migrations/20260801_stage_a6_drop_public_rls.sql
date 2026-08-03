-- Stage A / A6: Drop public RLS policies from legacy tables that have NO
-- tenant boundary and tighten SECURITY DEFINER functions that expose raw
-- aggregates to anon/authenticated roles.
--
-- Rationale: The legacy `customers`, `auto_reply_rules`, and
-- `quick_replies` policies predate the multi-tenant model. They allow
-- `anon` and `authenticated` roles full read/write to internal data
-- structures, violating least privilege. Drop them so application code
-- must go through the Supabase JS client with the JWT (which we now
-- verify at L2 via `withApi`).
--
-- The two SECURITY DEFINER RPCs (`rls_auto_enable` and
-- `alerts_aggregate_stats`) expose schema-level information that should
-- never be callable by client roles. They remain callable by `postgres`
-- / `service_role` (the Supabase admin connection) so migrations and
-- background schedulers can still use them.

begin;

drop policy if exists customers_public_read   on public.customers;
drop policy if exists customers_public_write  on public.customers;
drop policy if exists auto_reply_rules_public on public.auto_reply_rules;
drop policy if exists quick_replies_public    on public.quick_replies;

revoke execute on function public.rls_auto_enable()       from anon, authenticated;
revoke execute on function public.alerts_aggregate_stats() from anon, authenticated;

commit;

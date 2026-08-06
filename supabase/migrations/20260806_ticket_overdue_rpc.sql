-- Migration: 20260806_ticket_overdue_rpc.sql
-- Purpose: Database-side overdue_count calculation for getTicketStats
-- Created: 2026-08-06
--
-- Replaces the JS-side loop in src/server/repositories/analytics-repository.ts
-- (getTicketStats, ~lines 474-491) that pulled ALL open+in_progress tickets and
-- iterated them in Node to compute overdue_count. With ticket tables growing
-- past 10k rows, that loop became a bottleneck.
--
-- This RPC accepts the SLA config (priority -> minutes) as a jsonb parameter
-- and returns the count directly from SQL. The 24h default fallback path is
-- kept in the repository for backward compatibility (so callers without an
-- SLA config still get a fast count query without an RPC round-trip).
--
-- SECURITY: STABLE + sql language, no elevated privileges required.

CREATE OR REPLACE FUNCTION get_ticket_overdue_count(p_sla_config jsonb)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH sla AS (
    SELECT key AS priority, value::text::int AS sla_minutes
    FROM jsonb_each_text(p_sla_config)
  )
  SELECT COUNT(*)::integer
  FROM tickets t
  INNER JOIN sla ON t.priority = sla.priority
  WHERE t.status IN ('open', 'in_progress')
    AND EXTRACT(EPOCH FROM (NOW() - t.created_at)) > (sla.sla_minutes * 60);
$$;

COMMENT ON FUNCTION get_ticket_overdue_count(jsonb) IS
  'Returns count of open/in_progress tickets whose age exceeds the per-priority SLA (in minutes). Jsonb shape: {"urgent": 120, "high": 480, "medium": 1440, "low": 2880}.';

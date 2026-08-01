-- =============================================================================
-- Sprint 5 / AL-3 -- atomic aggregate stats for the alerts table.
--
-- Background (see alert-repository.ts -> listStatsRows):
--   The dashboards previously fetched every row of `alerts` (SELECT severity,
--   is_resolved) and aggregated in JavaScript. That works while the table is
--   small, but degrades linearly with alert count and competes with the
--   alert-row reads the dashboard is already showing.
--
-- This RPC pushes the aggregation into Postgres so a single round-trip with
--   COUNT(*) FILTER (...) returns the same shape as the JS version
--   (total / unresolved / critical / warning). The shape is intentionally
--   a superset of what the service consumes today -- by_type / by_severity /
--   by_status are pre-computed so future cards can read them without
--   another full-table scan.
--
-- Field semantics, matched to the current JS aggregation:
--   total      = COUNT(*)                                 (all rows)
--   unresolved = COUNT(*) FILTER (WHERE is_resolved = false)
--   critical   = COUNT(*) FILTER (WHERE severity = 'critical' AND is_resolved = false)
--   warning    = COUNT(*) FILTER (WHERE severity = 'warning'  AND is_resolved = false)
--   open       = COUNT(*) FILTER (WHERE status = 'open')        (post-20260801_alert_status_column)
--   resolved   = COUNT(*) FILTER (WHERE status = 'resolved')
--   dismissed  = COUNT(*) FILTER (WHERE status = 'dismissed')
--   by_type    = jsonb { type => count }   (all rows)
--   by_severity= jsonb { severity => count } (all rows)
--   by_status  = jsonb { status => count }  (all rows)
--
-- SECURITY DEFINER: the function is owned by the migration role and bypasses
--   the alerts RLS read policy so a service-role caller can summarize every
--   row. Application code uses getSupabaseClient() (service role key) so
--   the elevated privileges are appropriate here.
-- =============================================================================

CREATE OR REPLACE FUNCTION alerts_aggregate_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total',       COUNT(*),
    'unresolved',  COUNT(*) FILTER (WHERE is_resolved = false),
    'critical',    COUNT(*) FILTER (WHERE severity = 'critical' AND is_resolved = false),
    'warning',     COUNT(*) FILTER (WHERE severity = 'warning'  AND is_resolved = false),
    'open',        COUNT(*) FILTER (WHERE status = 'open'),
    'resolved',    COUNT(*) FILTER (WHERE status = 'resolved'),
    'dismissed',   COUNT(*) FILTER (WHERE status = 'dismissed'),
    'by_type', (
      SELECT COALESCE(jsonb_object_agg(type, n), '{}'::jsonb)
      FROM (
        SELECT type, COUNT(*) AS n FROM alerts GROUP BY type
      ) t
    ),
    'by_severity', (
      SELECT COALESCE(jsonb_object_agg(severity, n), '{}'::jsonb)
      FROM (
        SELECT severity, COUNT(*) AS n FROM alerts GROUP BY severity
      ) t
    ),
    'by_status', (
      SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
      FROM (
        SELECT status, COUNT(*) AS n FROM alerts GROUP BY status
      ) t
    )
  ) INTO result
  FROM alerts;
  RETURN result;
END;
$$;

-- Only the service role consumes this RPC (dashboard aggregation runs in the
-- service_role context via getSupabaseClient()). Keep the blast radius small.
REVOKE ALL ON FUNCTION alerts_aggregate_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION alerts_aggregate_stats() TO service_role;

COMMENT ON FUNCTION alerts_aggregate_stats() IS
  'Sprint 5 / AL-3: aggregate counts over the alerts table in a single round-trip. '
  'Replaces the dashboard SELECT severity, is_resolved full-table scan.';

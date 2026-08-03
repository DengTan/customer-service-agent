-- Phase B / B1: explicit service-role pin for agent_assignment_stats.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "agent_assignment_stats_service_role_all" ON public.agent_assignment_stats;
CREATE POLICY "agent_assignment_stats_service_role_all"
  ON public.agent_assignment_stats
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

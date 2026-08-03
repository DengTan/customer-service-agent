-- Phase B / B1: explicit service-role pin for agent_assignment_config.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "agent_assignment_config_service_role_all" ON public.agent_assignment_config;
CREATE POLICY "agent_assignment_config_service_role_all"
  ON public.agent_assignment_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

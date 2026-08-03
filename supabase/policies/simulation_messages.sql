-- Phase B / B1: explicit service-role pin for simulation_messages.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "simulation_messages_service_role_all" ON public.simulation_messages;
CREATE POLICY "simulation_messages_service_role_all"
  ON public.simulation_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

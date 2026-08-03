-- Phase B / B1: explicit service-role pin for routing_rules.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "routing_rules_service_role_all" ON public.routing_rules;
CREATE POLICY "routing_rules_service_role_all"
  ON public.routing_rules
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

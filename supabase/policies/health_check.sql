-- Phase B / B1: explicit service-role pin for health_check.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "health_check_service_role_all" ON public.health_check;
CREATE POLICY "health_check_service_role_all"
  ON public.health_check
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Phase B / B1: explicit service-role pin for size_charts.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "size_charts_service_role_all" ON public.size_charts;
CREATE POLICY "size_charts_service_role_all"
  ON public.size_charts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Phase B / B1: explicit service-role pin for content_filter_logs.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "content_filter_logs_service_role_all" ON public.content_filter_logs;
CREATE POLICY "content_filter_logs_service_role_all"
  ON public.content_filter_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

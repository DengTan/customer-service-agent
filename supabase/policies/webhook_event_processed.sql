-- Phase B / B1: explicit service-role pin for webhook_event_processed.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "webhook_event_processed_service_role_all" ON public.webhook_event_processed;
CREATE POLICY "webhook_event_processed_service_role_all"
  ON public.webhook_event_processed
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

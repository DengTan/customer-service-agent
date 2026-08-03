-- Phase B / B1: explicit service-role pin for conversation_tag_records.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "conversation_tag_records_service_role_all" ON public.conversation_tag_records;
CREATE POLICY "conversation_tag_records_service_role_all"
  ON public.conversation_tag_records
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

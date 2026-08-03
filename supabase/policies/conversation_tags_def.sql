-- Phase B / B1: explicit service-role pin for conversation_tags_def.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "conversation_tags_def_service_role_all" ON public.conversation_tags_def;
CREATE POLICY "conversation_tags_def_service_role_all"
  ON public.conversation_tags_def
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

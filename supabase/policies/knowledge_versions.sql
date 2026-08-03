-- Phase B / B1: explicit service-role pin for knowledge_versions.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "knowledge_versions_service_role_all" ON public.knowledge_versions;
CREATE POLICY "knowledge_versions_service_role_all"
  ON public.knowledge_versions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

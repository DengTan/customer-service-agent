-- Phase B / B1: explicit service-role pin for skill_groups.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "skill_groups_service_role_all" ON public.skill_groups;
CREATE POLICY "skill_groups_service_role_all"
  ON public.skill_groups
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

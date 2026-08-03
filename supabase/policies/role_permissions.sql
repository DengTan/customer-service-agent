-- Phase B / B1: explicit service-role pin for role_permissions.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "role_permissions_service_role_all" ON public.role_permissions;
CREATE POLICY "role_permissions_service_role_all"
  ON public.role_permissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

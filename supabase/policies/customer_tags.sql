-- Phase B / B1: explicit service-role pin for customer_tags.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "customer_tags_service_role_all" ON public.customer_tags;
CREATE POLICY "customer_tags_service_role_all"
  ON public.customer_tags
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

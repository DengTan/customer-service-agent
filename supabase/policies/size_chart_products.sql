-- Phase B / B1: explicit service-role pin for size_chart_products.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "size_chart_products_service_role_all" ON public.size_chart_products;
CREATE POLICY "size_chart_products_service_role_all"
  ON public.size_chart_products
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

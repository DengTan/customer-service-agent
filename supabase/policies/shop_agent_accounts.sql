-- Phase B / B1: explicit service-role pin for shop_agent_accounts.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "shop_agent_accounts_service_role_all" ON public.shop_agent_accounts;
CREATE POLICY "shop_agent_accounts_service_role_all"
  ON public.shop_agent_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

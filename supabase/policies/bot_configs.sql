-- Phase B / B1: explicit service-role pin for bot_configs.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "bot_configs_service_role_all" ON public.bot_configs;
CREATE POLICY "bot_configs_service_role_all"
  ON public.bot_configs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

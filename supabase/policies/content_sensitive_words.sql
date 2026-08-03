-- Phase B / B1: explicit service-role pin for content_sensitive_words.
-- The application layer connects with service_role (bypasses RLS);
-- these policies are explicit so the snapshot tooling has something
-- to diff against. Tighten to a USING predicate if you ever expose
-- this table to anon/authenticated roles.

DROP POLICY IF EXISTS "content_sensitive_words_service_role_all" ON public.content_sensitive_words;
CREATE POLICY "content_sensitive_words_service_role_all"
  ON public.content_sensitive_words
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

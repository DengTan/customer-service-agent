-- auto_reply_rules RLS policies
-- The table has RLS enabled (relrowsecurity=true) but no policies,
-- causing all queries to be denied by default Supabase RLS behavior.

-- Allow all authenticated users to SELECT
CREATE POLICY "Allow select for authenticated users" ON auto_reply_rules
  FOR SELECT
  USING (true);

-- Allow all authenticated users to INSERT
CREATE POLICY "Allow insert for authenticated users" ON auto_reply_rules
  FOR INSERT
  WITH CHECK (true);

-- Allow all authenticated users to UPDATE
CREATE POLICY "Allow update for authenticated users" ON auto_reply_rules
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow all authenticated users to DELETE
CREATE POLICY "Allow delete for authenticated users" ON auto_reply_rules
  FOR DELETE
  USING (true);

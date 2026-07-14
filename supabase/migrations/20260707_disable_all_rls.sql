-- ============================================
-- Disable RLS on all tables
-- Date: 2026-07-07
-- Reason: SmartAssist uses custom JWT auth (not Supabase Auth),
--         so the RLS policies targeting 'authenticated' role never match.
--         All data access uses anon/service_role keys directly.
-- ============================================

-- List of all tables in the public schema
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('spatial_ref_sys', 'geometry_columns', 'geography_columns')
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
    RAISE NOTICE 'Disabled RLS on table: %', tbl;
  END LOOP;
END $$;

-- Verification: check no table has RLS enabled
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

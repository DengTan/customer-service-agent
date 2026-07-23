-- Enable RLS on retrieval_traces table
-- Migration: 20260714_enable_rls_retrieval_traces.sql

-- Enable RLS
ALTER TABLE retrieval_traces ENABLE ROW LEVEL SECURITY;

-- Create policy for service_role to do ALL operations
CREATE POLICY retrieval_traces_service_role_all
  ON retrieval_traces
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Revoke ALL from anon
REVOKE ALL ON retrieval_traces FROM anon;

-- Revoke ALL from authenticated
REVOKE ALL ON retrieval_traces FROM authenticated;

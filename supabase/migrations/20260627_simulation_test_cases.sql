-- Migration: Create simulation_test_cases table
-- Phase 6: Test Case Library

CREATE TABLE IF NOT EXISTS simulation_test_cases (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'tc-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  scripts JSONB NOT NULL DEFAULT '[]'::JSONB,
  expected_outcomes TEXT,
  tags TEXT[] DEFAULT '{}',
  source_conversation_id VARCHAR(100),
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_simulation_test_cases_category ON simulation_test_cases(category);
CREATE INDEX IF NOT EXISTS idx_simulation_test_cases_status ON simulation_test_cases(status);
CREATE INDEX IF NOT EXISTS idx_simulation_test_cases_created_by ON simulation_test_cases(created_by);
CREATE INDEX IF NOT EXISTS idx_simulation_test_cases_created_at ON simulation_test_cases(created_at DESC);

-- Comments
COMMENT ON TABLE simulation_test_cases IS 'Simulation test case library for storing reusable test scripts';
COMMENT ON COLUMN simulation_test_cases.scripts IS 'Array of test message contents';
COMMENT ON COLUMN simulation_test_cases.expected_outcomes IS 'Expected outcomes or evaluation criteria for the test';
COMMENT ON COLUMN simulation_test_cases.source_conversation_id IS 'Original simulation conversation ID this test case was created from';

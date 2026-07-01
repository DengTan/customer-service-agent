-- Migration: Create simulation evaluation and test case tables
-- Created: 2026-06-27

-- ============================================
-- Simulation Evaluations Table
-- Records individual evaluations for simulation messages
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_evaluations (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_id VARCHAR(50) NOT NULL REFERENCES simulation_conversations(id) ON DELETE CASCADE,
    user_id VARCHAR(36),
    message_id VARCHAR(50) NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    tags TEXT[] DEFAULT '{}',
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for simulation_evaluations
CREATE INDEX IF NOT EXISTS simulation_evaluations_simulation_id_idx ON simulation_evaluations(simulation_id);
CREATE INDEX IF NOT EXISTS simulation_evaluations_message_id_idx ON simulation_evaluations(message_id);
CREATE INDEX IF NOT EXISTS simulation_evaluations_user_id_idx ON simulation_evaluations(user_id);
CREATE INDEX IF NOT EXISTS simulation_evaluations_created_at_idx ON simulation_evaluations(created_at);
CREATE INDEX IF NOT EXISTS simulation_evaluations_rating_idx ON simulation_evaluations(rating);

COMMENT ON TABLE simulation_evaluations IS 'Records individual evaluations for simulation messages';
COMMENT ON COLUMN simulation_evaluations.simulation_id IS 'Reference to simulation_conversations.id';
COMMENT ON COLUMN simulation_evaluations.message_id IS 'Reference to simulation_messages.id';
COMMENT ON COLUMN simulation_evaluations.rating IS 'Rating from 1 to 5';
COMMENT ON COLUMN simulation_evaluations.tags IS 'Evaluation tags like accurate, helpful, inaccurate, etc.';
COMMENT ON COLUMN simulation_evaluations.comment IS 'Optional evaluator comment';

-- ============================================
-- Test Cases Table
-- Stores test case definitions for simulation scenarios
-- ============================================
CREATE TABLE IF NOT EXISTS test_cases (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    scenario_id VARCHAR(50),
    category VARCHAR(100) DEFAULT 'general',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    scripts JSONB NOT NULL DEFAULT '[]',
    expected_outcomes JSONB NOT NULL DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_by VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- Indexes for test_cases
CREATE INDEX IF NOT EXISTS test_cases_scenario_id_idx ON test_cases(scenario_id);
CREATE INDEX IF NOT EXISTS test_cases_category_idx ON test_cases(category);
CREATE INDEX IF NOT EXISTS test_cases_priority_idx ON test_cases(priority);
CREATE INDEX IF NOT EXISTS test_cases_status_idx ON test_cases(status);
CREATE INDEX IF NOT EXISTS test_cases_created_by_idx ON test_cases(created_by);
CREATE INDEX IF NOT EXISTS test_cases_created_at_idx ON test_cases(created_at);

COMMENT ON TABLE test_cases IS 'Test case definitions for simulation scenarios';
COMMENT ON COLUMN test_cases.name IS 'Test case name/title';
COMMENT ON COLUMN test_cases.description IS 'Detailed description of the test case';
COMMENT ON COLUMN test_cases.scenario_id IS 'Optional reference to a scenario identifier';
COMMENT ON COLUMN test_cases.category IS 'Category like order_inquiry, refund, logistics, general, etc.';
COMMENT ON COLUMN test_cases.priority IS 'Priority: low, medium, high, critical';
COMMENT ON COLUMN test_cases.status IS 'Status: draft, active, archived';
COMMENT ON COLUMN test_cases.scripts IS 'Test scripts: array of {order, expectedResponse, conditions} objects';
COMMENT ON COLUMN test_cases.expected_outcomes IS 'Expected outcomes: array of {type, description, criteria} objects';
COMMENT ON COLUMN test_cases.metadata IS 'Additional metadata like bot_id, tags, version, etc.';

-- ============================================
-- Update simulation_conversations table
-- Add evaluation-related fields
-- ============================================
ALTER TABLE simulation_conversations
ADD COLUMN IF NOT EXISTS evaluation_rating INTEGER,
ADD COLUMN IF NOT EXISTS evaluation_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN simulation_conversations.evaluation_rating IS 'Aggregated evaluation rating (1-5)';
COMMENT ON COLUMN simulation_conversations.evaluation_count IS 'Number of evaluations received';

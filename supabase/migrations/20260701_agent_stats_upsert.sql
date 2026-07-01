-- Migration: Create atomic upsert function for agent_assignment_stats
-- Date: 2026-07-01
-- Purpose: Eliminate race conditions in concurrent stats updates

BEGIN;

-- Drop existing function if exists (for clean re-creation)
DROP FUNCTION IF EXISTS upsert_agent_stats(
  UUID,
  DATE,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ
);

-- Create atomic upsert function
CREATE OR REPLACE FUNCTION upsert_agent_stats(
  p_user_id UUID,
  p_date DATE,
  p_assigned_delta INTEGER DEFAULT 0,
  p_completed_delta INTEGER DEFAULT 0,
  p_last_assigned_at TIMESTAMPTZ DEFAULT NULL
) RETURNS void AS $$
DECLARE
  existing_count INTEGER;
BEGIN
  -- Check if record exists
  SELECT COUNT(*) INTO existing_count FROM agent_assignment_stats 
  WHERE user_id = p_user_id AND date = p_date;
  
  IF existing_count > 0 THEN
    -- Update existing record atomically
    UPDATE agent_assignment_stats SET
      assigned_count = assigned_count + p_assigned_delta,
      completed_count = completed_count + p_completed_delta,
      last_assigned_at = COALESCE(p_last_assigned_at, last_assigned_at)
    WHERE user_id = p_user_id AND date = p_date;
  ELSE
    -- Insert new record
    INSERT INTO agent_assignment_stats (user_id, date, assigned_count, completed_count, last_assigned_at)
    VALUES (p_user_id, p_date, p_assigned_delta, p_completed_delta, p_last_assigned_at);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated role
GRANT EXECUTE ON FUNCTION upsert_agent_stats(UUID, DATE, INTEGER, INTEGER, TIMESTAMPTZ) TO authenticated;

COMMIT;

-- Migration: 20260711_quality_improvements.sql
-- Date: 2026-07-11
-- Description: Quality module improvements
--   1. Add unique constraint on quality_rules.name
--   2. Add created_at index on quality_checks for date-range stats queries

-- 1. Add UNIQUE constraint on quality_rules.name
-- First check if there are duplicates before adding constraint
DO $$
BEGIN
  -- Only add constraint if no duplicates exist
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT name, COUNT(*) as cnt
      FROM quality_rules
      GROUP BY name
      HAVING COUNT(*) > 1
    ) dup
  ) THEN
    ALTER TABLE quality_rules ADD CONSTRAINT quality_rules_name_unique UNIQUE (name);
  END IF;
END $$;

-- 2. Add created_at index on quality_checks for date-range aggregation stats
CREATE INDEX IF NOT EXISTS quality_checks_created_at_idx ON quality_checks (created_at);

-- Also add composite index for common query pattern: result + created_at (for filtered time-range stats)
CREATE INDEX IF NOT EXISTS quality_checks_result_created_at_idx ON quality_checks (result, created_at);

-- Migration: Add parent_ticket_id column to tickets table
-- Enables parent-child ticket hierarchy (sub-tickets)
-- Date: 2026-07-01

-- Add parent_ticket_id foreign key column
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parent_ticket_id varchar(36);

-- Add foreign key constraint
ALTER TABLE tickets
  ADD CONSTRAINT tickets_parent_ticket_id_fkey
  FOREIGN KEY (parent_ticket_id)
  REFERENCES tickets(id)
  ON DELETE SET NULL;

-- Create index for efficient parent-child queries
CREATE INDEX IF NOT EXISTS tickets_parent_ticket_id_idx ON tickets(parent_ticket_id);

-- Grant permissions (if using service_role)
-- Note: RLS policies may need to be updated separately

-- Migration: Add unique constraint on role_permissions(role, resource, action)
-- Purpose: Prevent duplicate permission entries and enable reliable upsert

-- Step 1: Delete duplicate rows (keep newest by updated_at)
DELETE FROM role_permissions a
USING role_permissions b
WHERE a.ctid < b.ctid
  AND a.role = b.role
  AND a.resource = b.resource
  AND a.action = b.action;

-- Step 2: Add unique constraint
ALTER TABLE role_permissions 
  ADD CONSTRAINT role_permissions_role_resource_action_unique 
  UNIQUE (role, resource, action);

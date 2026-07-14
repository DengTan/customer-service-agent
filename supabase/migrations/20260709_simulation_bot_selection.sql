-- Add bot_id and bot_name to simulation_conversations for Bot selection support

ALTER TABLE simulation_conversations
ADD COLUMN IF NOT EXISTS bot_id VARCHAR(36),
ADD COLUMN IF NOT EXISTS bot_name VARCHAR(255);

-- Add foreign key constraint (optional, if bot_configs table exists)
-- ALTER TABLE simulation_conversations
-- ADD CONSTRAINT simulation_conversations_bot_id_fkey
-- FOREIGN KEY (bot_id) REFERENCES bot_configs(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS simulation_conversations_bot_id_idx ON simulation_conversations(bot_id);

-- Comments for documentation
COMMENT ON COLUMN simulation_conversations.bot_id IS 'Selected bot ID for this simulation conversation';
COMMENT ON COLUMN simulation_conversations.bot_name IS 'Selected bot name (denormalized for display)';

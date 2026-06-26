-- Gorgias Integration: Add metadata columns
-- Run this migration to enable Gorgias webhook sync

-- Add metadata column to conversations table
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Add metadata column to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Create index on metadata for faster Gorgias ticket lookups
CREATE INDEX IF NOT EXISTS conversations_metadata_gorgias_idx 
ON conversations USING GIN (metadata) 
WHERE metadata IS NOT NULL AND metadata ? 'gorgias_ticket_id';

CREATE INDEX IF NOT EXISTS messages_metadata_gorgias_idx 
ON messages USING GIN (metadata) 
WHERE metadata IS NOT NULL AND metadata ? 'gorgias_message_id';

-- Update source enum to include Gorgias sources (if using enum)
-- ALTER TYPE conversation_source ADD VALUE IF NOT EXISTS 'gorgias_email';
-- ALTER TYPE conversation_source ADD VALUE IF NOT EXISTS 'gorgias_chat';
-- ALTER TYPE conversation_source ADD VALUE IF NOT EXISTS 'gorgias_phone';

COMMENT ON COLUMN conversations.metadata IS '扩展元数据，存储 gorgias_ticket_id、gorgias_tags 等';
COMMENT ON COLUMN messages.metadata IS '扩展元数据，存储 gorgias_message_id、gorgias_author 等';

-- Performance Optimization Migration
-- Created: 2026-08-06
-- Purpose: Add indexes for common queries and RPC functions for atomic operations

-- ============================================================================
-- 1. Indexes for frequently queried fields
-- ============================================================================

-- customers.tags JSONB contains query (for tag-based filtering)
CREATE INDEX IF NOT EXISTS customers_tags_jsonb_idx ON customers USING GIN (tags);

-- quick_replies: composite index for common query pattern (scope + usage_count)
CREATE INDEX IF NOT EXISTS quick_replies_scope_usage_count_idx ON quick_replies (scope, usage_count DESC);

-- knowledge_items: composite index for archive filtering
CREATE INDEX IF NOT EXISTS knowledge_items_archived_created_idx ON knowledge_items (archived_at NULLS FIRST, created_at DESC) 
WHERE archived_at IS NULL;

-- conversations: composite index for status + created_at (common dashboard query)
CREATE INDEX IF NOT EXISTS conversations_status_created_idx ON conversations (status, created_at DESC);

-- messages: composite index for conversation + created_at (message listing)
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages (conversation_id, created_at DESC);

-- tickets: composite index for status + priority + created_at (ticket listing)
CREATE INDEX IF NOT EXISTS tickets_status_priority_created_idx ON tickets (status, priority, created_at DESC);

-- alerts: composite index for is_resolved + created_at (alert listing)
CREATE INDEX IF NOT EXISTS alerts_resolved_created_idx ON alerts (is_resolved, created_at DESC);

-- product_details: composite index for status + created_at (product listing)
CREATE INDEX IF NOT EXISTS product_details_status_created_idx ON product_details (status, created_at DESC);

-- size_charts: composite index for status + created_at (size chart listing)
CREATE INDEX IF NOT EXISTS size_charts_status_created_idx ON size_charts (status, created_at DESC);

-- agent_queue: composite index for status + priority + created_at (queue listing)
CREATE INDEX IF NOT EXISTS agent_queue_status_priority_created_idx ON agent_queue (status, priority, created_at DESC);

-- marketing_logs: composite index for campaign + sent_at (marketing analytics)
CREATE INDEX IF NOT EXISTS marketing_logs_campaign_sent_idx ON marketing_logs (campaign_id, sent_at DESC);

-- knowledge_feedback: composite index for knowledge_item + created_at (feedback analytics)
CREATE INDEX IF NOT EXISTS knowledge_feedback_item_created_idx ON knowledge_feedback (knowledge_item_id, created_at DESC);

-- knowledge_gap_signals: composite index for status + frequency (gap analysis)
CREATE INDEX IF NOT EXISTS knowledge_gap_status_frequency_idx ON knowledge_gap_signals (status, frequency DESC);

-- ============================================================================
-- 1b. Additional High-Priority Indexes (from performance analysis)
-- ============================================================================

-- conversations: source field for platform-based filtering and aggregation
CREATE INDEX IF NOT EXISTS conversations_source_idx ON conversations (source);

-- conversations: external_user_id for platform user lookups
CREATE INDEX IF NOT EXISTS conversations_external_user_id_idx ON conversations (external_user_id);

-- conversations: rating for filtering rated/unrated conversations
CREATE INDEX IF NOT EXISTS conversations_rating_idx ON conversations (rating) WHERE rating IS NOT NULL;

-- messages: role field for filtering user/assistant messages
CREATE INDEX IF NOT EXISTS messages_role_idx ON messages (role);

-- messages: composite for conversation + role (common query)
CREATE INDEX IF NOT EXISTS messages_conversation_role_idx ON messages (conversation_id, role);

-- tickets: category for category-based filtering
CREATE INDEX IF NOT EXISTS tickets_category_idx ON tickets (category);

-- tickets: creator_id for creator-based queries
CREATE INDEX IF NOT EXISTS tickets_creator_id_idx ON tickets (creator_id);

-- ticket_comments: author_id for author-based queries
CREATE INDEX IF NOT EXISTS ticket_comments_author_id_idx ON ticket_comments (author_id);

-- marketing_logs: sent_at for time-based queries
CREATE INDEX IF NOT EXISTS marketing_logs_sent_at_idx ON marketing_logs (sent_at DESC);

-- marketing_logs: converted for filtering converted records
CREATE INDEX IF NOT EXISTS marketing_logs_converted_idx ON marketing_logs (converted) WHERE converted = true;

-- knowledge_feedback: conversation_id for feedback lookup by conversation
CREATE INDEX IF NOT EXISTS knowledge_feedback_conversation_id_idx ON knowledge_feedback (conversation_id);

-- quick_replies: creator_id for personal quick replies
CREATE INDEX IF NOT EXISTS quick_replies_creator_id_idx ON quick_replies (creator_id);

-- skill_groups: member_ids GIN index for JSONB contains queries
CREATE INDEX IF NOT EXISTS skill_groups_member_ids_idx ON skill_groups USING GIN (member_ids);

-- schedules: skill_group_id for skill-based queries
CREATE INDEX IF NOT EXISTS schedules_skill_group_id_idx ON schedules (skill_group_id);

-- schedules: status for active schedule queries
CREATE INDEX IF NOT EXISTS schedules_status_idx ON schedules (status);

-- bot_configs: status for filtering enabled/disabled bots
CREATE INDEX IF NOT EXISTS bot_configs_status_idx ON bot_configs (status);

-- product_details: hit_count for sorting by popularity
CREATE INDEX IF NOT EXISTS product_details_hit_count_idx ON product_details (hit_count DESC);

-- product_details: platform_connection_id for shop-based product queries
CREATE INDEX IF NOT EXISTS product_details_platform_connection_id_idx ON product_details (platform_connection_id);

-- size_charts: hit_count for sorting by popularity
CREATE INDEX IF NOT EXISTS size_charts_hit_count_idx ON size_charts (hit_count DESC);

-- customers: is_anonymous for filtering anonymous customers
CREATE INDEX IF NOT EXISTS customers_is_anonymous_idx ON customers (is_anonymous);

-- agent_sessions: current_conversation_id for active session queries
CREATE INDEX IF NOT EXISTS agent_sessions_current_conversation_id_idx ON agent_sessions (current_conversation_id) WHERE current_conversation_id IS NOT NULL;

-- agent_delegations: created_at for delegation history sorting
CREATE INDEX IF NOT EXISTS agent_delegations_created_at_idx ON agent_delegations (created_at DESC);

-- login_events: success for filtering success/failure events
CREATE INDEX IF NOT EXISTS login_events_success_idx ON login_events (success);

-- login_events: event_type for type-based queries
CREATE INDEX IF NOT EXISTS login_events_event_type_idx ON login_events (event_type);

-- ============================================================================
-- 2. RPC Functions for Atomic Operations
-- ============================================================================

-- Function: increment_product_hit_count
-- Atomically increments hit_count and updates last_hit_at for a product
CREATE OR REPLACE FUNCTION increment_product_hit_count(product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE product_details
  SET 
    hit_count = COALESCE(hit_count, 0) + 1,
    last_hit_at = NOW()
  WHERE id = product_id;
END;
$$;

-- Function: increment_size_chart_hit_count
-- Atomically increments hit_count and updates last_hit_at for a size chart
CREATE OR REPLACE FUNCTION increment_size_chart_hit_count(chart_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE size_charts
  SET 
    hit_count = COALESCE(hit_count, 0) + 1,
    last_hit_at = NOW()
  WHERE id = chart_id;
END;
$$;

-- Function: increment_knowledge_item_hit_count
-- Atomically increments hit_count and updates last_hit_at for a knowledge item
CREATE OR REPLACE FUNCTION increment_knowledge_item_hit_count(item_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE knowledge_items
  SET 
    hit_count = COALESCE(hit_count, 0) + 1,
    last_hit_at = NOW()
  WHERE id = item_id;
END;
$$;

-- Function: increment_hit_count_by_word
-- Atomically increments hit_count for content_sensitive_words by word
CREATE OR REPLACE FUNCTION increment_hit_count_by_word(word TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE content_sensitive_words
  SET hit_count = COALESCE(hit_count, 0) + 1
  WHERE word = increment_hit_count_by_word.word;
END;
$$;

-- Update the generic function to handle both UUID and word-based lookups
CREATE OR REPLACE FUNCTION increment_hit_count(
  table_name TEXT,
  row_word TEXT DEFAULT NULL,
  row_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF table_name = 'content_sensitive_words' AND row_word IS NOT NULL THEN
    UPDATE content_sensitive_words
    SET hit_count = COALESCE(hit_count, 0) + 1
    WHERE word = row_word;
  ELSIF row_id IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I SET hit_count = COALESCE(hit_count, 0) + 1, last_hit_at = NOW() WHERE id = $1',
      table_name
    ) USING row_id;
  END IF;
END;
$$;

-- ============================================================================
-- 3. Partial Indexes for Common Filters
-- ============================================================================

-- Partial index for active conversations only (most common query)
CREATE INDEX IF NOT EXISTS conversations_active_idx ON conversations (created_at DESC)
WHERE status = 'active';

-- Partial index for open tickets only
CREATE INDEX IF NOT EXISTS tickets_open_idx ON tickets (created_at DESC)
WHERE status = 'open';

-- Partial index for unresolved alerts only
CREATE INDEX IF NOT EXISTS alerts_unresolved_idx ON alerts (created_at DESC)
WHERE is_resolved = false;

-- Partial index for on-sale products only
CREATE INDEX IF NOT EXISTS product_details_on_sale_idx ON product_details (created_at DESC)
WHERE status = 'on_sale';

-- Partial index for active size charts only
CREATE INDEX IF NOT EXISTS size_charts_active_idx ON size_charts (created_at DESC)
WHERE status = 'active';

-- Partial index for queued agent queue items only
CREATE INDEX IF NOT EXISTS agent_queue_queued_idx ON agent_queue (created_at ASC)
WHERE status = 'queued';

-- ============================================================================
-- 4. Summary Statistics Views for Dashboard
-- ============================================================================

-- View: conversation_stats_summary
-- Provides aggregated conversation statistics
CREATE OR REPLACE VIEW conversation_stats_summary AS
SELECT 
  status,
  COUNT(*) as count,
  AVG(message_count) as avg_messages
FROM conversations
GROUP BY status;

-- View: ticket_stats_summary
-- Provides aggregated ticket statistics
CREATE OR REPLACE VIEW ticket_stats_summary AS
SELECT 
  status,
  priority,
  COUNT(*) as count
FROM tickets
GROUP BY status, priority;

-- ============================================================================
-- Metadata
-- ============================================================================

DO $$
BEGIN
  -- Record migration in schema migrations table (if exists)
  -- This is a no-op if the table doesn't exist
  INSERT INTO schema_migrations (version, description, applied_at)
  VALUES ('20260806_performance_optimization', 'Performance optimization: indexes + atomic RPC functions', NOW())
  ON CONFLICT (version) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  -- schema_migrations table doesn't exist, skip
  NULL;
END $$;

-- Comment for documentation
COMMENT ON INDEX customers_tags_jsonb_idx IS 'GIN index for JSONB array contains queries on customers.tags';
COMMENT ON INDEX quick_replies_scope_usage_count_idx IS 'Composite index for quick replies filtering by scope and sorting by usage_count';
COMMENT ON FUNCTION increment_product_hit_count IS 'Atomic increment of product hit_count with timestamp update';
COMMENT ON FUNCTION increment_size_chart_hit_count IS 'Atomic increment of size_chart hit_count with timestamp update';
COMMENT ON FUNCTION increment_knowledge_item_hit_count IS 'Atomic increment of knowledge_item hit_count with timestamp update';

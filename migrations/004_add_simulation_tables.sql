-- Migration: Add simulation tables
-- Created: 2026-06-25
-- Description: Creates tables for persistent simulation testing data

-- ============================================
-- Simulation Conversations Table
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_conversations (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    scenario_id VARCHAR(50),
    scenario_name VARCHAR(100) NOT NULL DEFAULT '订单查询',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS simulation_conversations_status_idx 
    ON simulation_conversations(status);
CREATE INDEX IF NOT EXISTS simulation_conversations_created_at_idx 
    ON simulation_conversations(created_at);

-- ============================================
-- Simulation Messages Table
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_messages (
    id VARCHAR(50) PRIMARY KEY,
    conversation_id VARCHAR(50) NOT NULL REFERENCES simulation_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    sources JSONB,
    confidence DOUBLE PRECISION,
    confidence_breakdown JSONB,
    tool_calls JSONB,
    tool_results JSONB,
    image_url TEXT,
    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
    rich_content JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS simulation_messages_conversation_id_idx 
    ON simulation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS simulation_messages_created_at_idx 
    ON simulation_messages(created_at);

-- ============================================
-- RPC Function: Increment message count
-- ============================================
CREATE OR REPLACE FUNCTION increment_simulation_message_count(conv_id VARCHAR(50))
RETURNS VOID AS $$
BEGIN
    UPDATE simulation_conversations 
    SET message_count = message_count + 1,
        updated_at = NOW()
    WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;

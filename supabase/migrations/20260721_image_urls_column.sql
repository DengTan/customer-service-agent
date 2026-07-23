-- Migration: Add image_urls column to support multiple images per knowledge item
-- Date: 2026-07-21

-- Add image_urls column as JSONB array to store multiple image URLs
ALTER TABLE knowledge_items 
ADD COLUMN IF NOT EXISTS image_urls jsonb DEFAULT '[]'::jsonb;

-- Create index for image_urls array operations
CREATE INDEX IF NOT EXISTS knowledge_items_image_urls_idx ON knowledge_items USING gin (image_urls);

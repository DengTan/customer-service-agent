-- Drop api_type column from llm_providers table
-- Rationale: LLMClientAdapter unifies on OpenAI-compatible format;
-- api_type was never consumed in the call path and is now obsolete.
ALTER TABLE llm_providers DROP COLUMN IF EXISTS api_type;

-- Remove deprecated single-LLM provider key in favour of multi-provider model.
-- Safe and idempotent: scoped by key, no-op if already absent.
DELETE FROM settings WHERE key = 'llm_provider_id';

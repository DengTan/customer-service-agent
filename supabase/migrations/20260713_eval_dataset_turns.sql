-- Migration: 20260713_eval_dataset_turns.sql
-- Phase: P4 RAG Evaluation Framework
-- Task: Phase 1.1 — Eval Dataset Turns Migration
--
-- Creates the eval_dataset_turns table that stores individual conversation turns
-- within an evaluation dataset version. Each turn captures the input state, gold
-- standard decisions, and provenance metadata for RAG evaluation scoring.

-- ============================================================================
-- Table: eval_dataset_turns
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eval_dataset_turns (
  -- Primary key
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Version reference (belongs to a dataset version)
  eval_dataset_version_id varchar(36) NOT NULL
    REFERENCES public.eval_dataset_versions(id) ON DELETE CASCADE,

  -- Turn ordering within the version
  turn_index integer NOT NULL,

  -- Input: user message (raw text)
  input_user_message text NOT NULL,

  -- Input: SHA-256 hex digest of the user message for safe PII referential linking
  input_user_message_digest varchar(64) NOT NULL,

  -- Input: recent conversation messages (JSON array of message objects)
  input_recent_messages jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Input: bot/shop context for this turn
  input_bot_id varchar(36) REFERENCES public.bot_configs(id) ON DELETE SET NULL,
  input_shop_id varchar(36) REFERENCES public.shops(id) ON DELETE SET NULL,

  -- Gold standard: routing gate decision
  -- skip     = bypass retrieval, answer from context
  -- retrieve = must retrieve citations before answering
  -- clarify  = need clarification from user
  gold_gate_decision varchar(16) NOT NULL,

  -- Gold standard: citation list (source knowledge item IDs / chunks)
  gold_citations jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Gold standard: expected answer text
  gold_answer text NOT NULL,

  -- Gold standard: acceptable alternative answer phrasings
  gold_answer_alt text[] NOT NULL DEFAULT '{}',

  -- Gold standard: factual claims that should appear in answer
  gold_answer_facts text[] NOT NULL DEFAULT '{}',

  -- Gold standard: topics where retrieval is NOT expected
  gold_no_support_topics text[] NOT NULL DEFAULT '{}',

  -- Gold standard: whether this turn should trigger handoff
  gold_should_handoff boolean NOT NULL DEFAULT false,

  -- Gold standard: whether this turn should trigger auto-reply
  gold_should_auto_reply boolean NOT NULL DEFAULT false,

  -- Turn difficulty level
  difficulty varchar(8) NOT NULL,

  -- Turn category (e.g., refund, shipping, product, complaint)
  category varchar(32) NOT NULL,

  -- Source tracking (optional references to original data)
  source_conversation_id varchar(36) REFERENCES public.conversations(id) ON DELETE SET NULL,
  source_simulation_id varchar(50),
  source_message_id varchar(50),

  -- Provenance: how this turn was created
  -- synthetic      = AI-generated with verification
  -- human_labeled = manually annotated
  -- sampled_real  = sampled from real production data
  provenance varchar(16) NOT NULL,

  -- Annotator tracking
  annotator_id varchar(36) REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by varchar(36) REFERENCES public.users(id) ON DELETE SET NULL,

  -- Timestamp
  created_at timestamptz NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT eval_turns_decision_chk
    CHECK (gold_gate_decision IN ('skip','retrieve','clarify')),
  CONSTRAINT eval_turns_exclusive_chk
    CHECK (NOT (gold_should_handoff AND gold_should_auto_reply)),
  CONSTRAINT eval_turns_difficulty_chk
    CHECK (difficulty IN ('easy','medium','hard')),
  CONSTRAINT eval_turns_provenance_chk
    CHECK (provenance IN ('synthetic','human_labeled','sampled_real')),
  CONSTRAINT eval_turns_unique_index UNIQUE (eval_dataset_version_id, turn_index)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Index for filtering by version (most common query pattern)
CREATE INDEX IF NOT EXISTS eval_turns_version_idx
  ON public.eval_dataset_turns(eval_dataset_version_id);

-- Index for filtering by bot (eval runs target specific bots)
CREATE INDEX IF NOT EXISTS eval_turns_bot_idx
  ON public.eval_dataset_turns(input_bot_id);

-- Index for category-based analysis
CREATE INDEX IF NOT EXISTS eval_turns_category_idx
  ON public.eval_dataset_turns(category);

-- Index for difficulty-based analysis and stratified sampling
CREATE INDEX IF NOT EXISTS eval_turns_difficulty_idx
  ON public.eval_dataset_turns(difficulty);

-- ============================================================================
-- Citation Guard Trigger
-- ============================================================================

-- Cite-precision guard: when gold_gate_decision = 'retrieve', at least one
-- citation must be present. This enforces annotation quality and prevents
-- "retrieve" decisions without supporting knowledge base evidence.

CREATE OR REPLACE FUNCTION eval_turns_require_citation_when_retrieve()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gold_gate_decision = 'retrieve'
     AND jsonb_array_length(NEW.gold_citations) < 1 THEN
    RAISE EXCEPTION
      'gold_citations must contain at least 1 entry when gold_gate_decision=retrieve';
  END IF;
  RETURN NEW;
END;
$$;

-- Apply trigger to enforce citation requirement
DROP TRIGGER IF EXISTS eval_turns_require_citation_trg
  ON public.eval_dataset_turns;

CREATE TRIGGER eval_turns_require_citation_trg
  BEFORE INSERT OR UPDATE ON public.eval_dataset_turns
  FOR EACH ROW EXECUTE FUNCTION eval_turns_require_citation_when_retrieve();

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE public.eval_dataset_turns IS
  'Individual conversation turns within an eval dataset version. Each turn has input state, gold standard decisions, and provenance for RAG evaluation scoring.';

COMMENT ON COLUMN public.eval_dataset_turns.input_user_message_digest IS
  'SHA-256 hex of input_user_message for safe cross-dataset PII-free referential linking.';

COMMENT ON COLUMN public.eval_dataset_turns.gold_gate_decision IS
  'Routing decision: skip=answer from context, retrieve=must cite KB, clarify=need user input.';

COMMENT ON COLUMN public.eval_dataset_turns.gold_should_handoff IS
  'Whether this turn should trigger handoff to human agent (mutually exclusive with gold_should_auto_reply).';

COMMENT ON COLUMN public.eval_dataset_turns.gold_should_auto_reply IS
  'Whether this turn should trigger auto-reply (mutually exclusive with gold_should_handoff).';

COMMENT ON COLUMN public.eval_dataset_turns.provenance IS
  'How the turn was created: synthetic (AI-generated), human_labeled, or sampled_real (from production).';

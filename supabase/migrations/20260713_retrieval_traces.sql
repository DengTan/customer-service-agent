-- P3 Phase 1: Retrieval trace persistence
-- Every assistant message that runs the LLM stream produces a `retrieval_traces` row
-- alongside the existing `messages` row. Audit / regression / "why did the model cite X"
-- becomes answerable.

CREATE TABLE IF NOT EXISTS public.retrieval_traces (
  id                     varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id        varchar(36) NOT NULL,
  message_id             varchar(36),                                  -- nullable until assistant row exists
  decision_action        varchar(20)  NOT NULL,
  decision_reason_code   varchar(40)  NOT NULL,
  effective_query        text         NOT NULL,
  effective_query_digest varchar(64)  NOT NULL,                        -- sha256 hex
  rerank_backend         varchar(16)  NOT NULL DEFAULT 'none',
  rerank_degraded        boolean      NOT NULL DEFAULT false,
  hybrid_search          boolean      NOT NULL DEFAULT false,
  candidate_count        integer      NOT NULL DEFAULT 0,
  accepted_count         integer      NOT NULL DEFAULT 0,
  citation_count         integer      NOT NULL DEFAULT 0,
  min_score              double precision NOT NULL DEFAULT 0,
  model_version          varchar(64),
  execution_time_ms      integer      NOT NULL DEFAULT 0,
  degradation_reasons    jsonb        NOT NULL DEFAULT '[]'::jsonb,
  synthetic_v1_backfill  boolean      NOT NULL DEFAULT false,
  bot_id                 varchar(36),
  trace_started_at       timestamptz  NOT NULL,
  trace_completed_at     timestamptz  NOT NULL DEFAULT now(),
  created_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retrieval_traces_conversation_idx   ON public.retrieval_traces (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS retrieval_traces_message_idx        ON public.retrieval_traces (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retrieval_traces_rerank_idx         ON public.retrieval_traces (rerank_backend, rerank_degraded);
CREATE INDEX IF NOT EXISTS retrieval_traces_digest_idx         ON public.retrieval_traces (effective_query_digest);

-- Append-only retention: 30 days. A separate operational migration drops older rows.

-- RLS: explicitly disabled to match the existing tables pattern (see 20260713_enable_rls_batches.sql /
-- 20260707_disable_all_rls.sql — the project currently runs without RLS on this family).
-- We DO NOT enable RLS in this migration; doing so would require aligning with that pattern.

-- Privileges: revoke PUBLIC, grant service_role only — same hardening as 20260713_rag_chunk_identity.sql.
REVOKE ALL ON TABLE public.retrieval_traces FROM PUBLIC;
REVOKE ALL ON TABLE public.retrieval_traces FROM anon;
REVOKE ALL ON TABLE public.retrieval_traces FROM authenticated;
GRANT ALL ON TABLE public.retrieval_traces TO service_role;

NOTIFY pgrst, 'reload';
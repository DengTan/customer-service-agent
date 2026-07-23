-- P3 Phase 2: Mark all existing retrieval_traces rows as synthetic v1 backfill.
--
-- All retrieval_traces rows written before the provenance governance date are
-- treated as synthetic backfill traces. The governance logic uses the
-- synthetic_v1_backfill flag on the trace (not the citation) to determine
-- whether to apply v1 rules. Rows marked here will have degraded=true in
-- the rerank_degraded column, signaling that provenance governance should
-- apply v1 rules to any citations referencing them.
--
-- Run this migration ONCE after deploying Phase 2 governance code.
-- Re-running is safe (idempotent update).

DO $$
BEGIN
  -- Only mark rows that don't already have synthetic_v1_backfill=true.
  -- This makes the migration idempotent and safe to re-run.
  UPDATE public.retrieval_traces
  SET
    synthetic_v1_backfill = true,
    rerank_degraded = true,
    -- Add degradation reason indicating this is a synthetic trace.
    -- Uses jsonb_set to add a field without overwriting existing array.
    degradation_reasons = CASE
      WHEN degradation_reasons IS NULL THEN '["synthetic_v1_backfill"]'::jsonb
      WHEN NOT (degradation_reasons @> '"synthetic_v1_backfill"'::jsonb) THEN
        degradation_reasons || '"synthetic_v1_backfill"'::jsonb
      ELSE degradation_reasons
    END
  WHERE synthetic_v1_backfill = false;
END $$;

-- Log how many rows were marked.
DO $$
DECLARE
  marked_count integer;
  total_count integer;
BEGIN
  SELECT count(*) INTO total_count FROM public.retrieval_traces;
  SELECT count(*) INTO marked_count FROM public.retrieval_traces WHERE synthetic_v1_backfill = true;
  RAISE NOTICE 'retrieval_traces backfill: %/% rows marked as synthetic_v1_backfill', marked_count, total_count;
END $$;

-- Grant permissions
GRANT ALL ON TABLE public.retrieval_traces TO service_role;
REVOKE ALL ON TABLE public.retrieval_traces FROM PUBLIC;
REVOKE ALL ON TABLE public.retrieval_traces FROM anon;
REVOKE ALL ON TABLE public.retrieval_traces FROM authenticated;

NOTIFY pgrst, 'reload';

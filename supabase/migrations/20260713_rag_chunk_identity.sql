-- ============================================================
-- P2: RAG Chunk Identity — Stable chunk_id for citations
-- ============================================================
--
-- Problem:
-- The existing match_knowledge_items RPC returns (id, content, chunk_index)
-- but:
--   - "id" is ambiguous: when joining with chunks it may return item_id or chunk_id
--   - No stable "chunk_id" field that uniquely identifies a chunk
--   - No "content_hash" for citation stability verification
--
-- Solution:
-- - Extend RPC to return: knowledge_item_id, chunk_id, chunk_index, content_hash
-- - When matching a parent item (no chunk), chunk_id must be NULL
--   (never alias item_id as chunk_id)
-- - content_hash from chunk if available, else from item
--
-- Design notes:
-- - PostgreSQL CREATE FUNCTION grants EXECUTE to PUBLIC by default; this
--   migration revokes that immediately after CREATE and grants only service_role.
-- - PostgreSQL CREATE OR REPLACE cannot change a RETURNS TABLE signature;
--   this migration uses DROP old-overload + CREATE new to safely replace it.
-- - No SECURITY DEFINER added (invoker semantics preserved).
-- - No new RLS policies (existing policies unchanged).
-- - Existing threshold/count parameters preserved.
-- - Vector index usage preserved (no performance regression).
-- - Embedding is stored as TEXT in the database and cast to vector(1024)
--   at query time via ::vector(1024) (pgvector extension).
-- - search_path = pg_catalog, public set inline and idempotent via ALTER.
--
-- Author: P2 Implementation
-- Date: 2026-07-13
-- ============================================================

-- 1. Drop the exact existing overload if it exists.
--    CREATE OR REPLACE cannot change a RETURNS TABLE OUT signature, so we
--    must DROP before CREATE.  This targets only the vector/float8/int variant;
--    other overloads (if any) are unaffected.
--    Uses to_regprocedure() for unambiguous OID resolution (type OIDs + pronargs).
--    DO NOT use CASCADE: if something depends on this RPC, DROP will safely fail.
DO $$
DECLARE
  existing_fn oid;
BEGIN
  existing_fn := to_regprocedure('public.match_knowledge_items(vector,double precision,integer)');
  IF existing_fn IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.match_knowledge_items(vector, double precision, integer) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.match_knowledge_items(vector, double precision, integer) FROM anon;
    REVOKE ALL ON FUNCTION public.match_knowledge_items(vector, double precision, integer) FROM authenticated;
    DROP FUNCTION public.match_knowledge_items(vector, double precision, integer);
    RAISE NOTICE 'Dropped public.match_knowledge_items(vector,double precision,integer).';
  ELSE
    RAISE NOTICE 'public.match_knowledge_items(vector,double precision,integer) does not exist; creating.';
  END IF;
END $$;

-- 2. Create the new RPC with stable chunk identity fields.
--    Embedding is stored as TEXT and cast to vector(1024) via ::vector(1024) at query time.
--    Key changes vs. 20260702_ollama_embedding:
--      - Returns knowledge_item_id (always populated, parent item UUID)
--      - Returns chunk_id (NULL when parent matched; never aliases item_id)
--      - Returns content_hash (chunk hash preferred, item hash fallback)
--      - Returns chunk_index (0 when parent matched directly)
CREATE FUNCTION public.match_knowledge_items(
  p_query_embedding  vector(1024),
  p_match_threshold  float8,
  p_match_count      int
)
RETURNS TABLE (
  knowledge_item_id text,   -- always populated (parent item UUID)
  chunk_id          text,  -- NULL when parent matched; NULL MUST NOT equal item_id
  chunk_index       int,   -- 0 when parent matched directly
  content_hash      text,  -- chunk hash preferred, item hash fallback
  content           text,  -- chunk content preferred, item content fallback
  name              text,
  category          text,
  similarity        float8
)
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ki.id::text                                               AS knowledge_item_id,
    kc.id::text                                               AS chunk_id,
    COALESCE(kc.chunk_index, 0)::int                         AS chunk_index,
    COALESCE(kc.content_hash, ki.content_hash)::text            AS content_hash,
    COALESCE(kc.content, ki.content)::text                     AS content,
    ki.name::text                                             AS name,
    COALESCE(ki.category, '未分类')::text                     AS category,
    (1::float8 - (
      COALESCE(kc.embedding, ki.embedding)::vector(1024)
      <=> p_query_embedding
    ))::float8                                               AS similarity
  FROM public.knowledge_items ki
  LEFT JOIN public.knowledge_chunks kc ON kc.knowledge_item_id = ki.id
  WHERE ki.status = 'active'
    AND COALESCE(kc.embedding, ki.embedding)::vector(1024) IS NOT NULL
    AND 1::float8 - (
      COALESCE(kc.embedding, ki.embedding)::vector(1024)
      <=> p_query_embedding
    ) >= p_match_threshold
  ORDER BY COALESCE(kc.embedding, ki.embedding)::vector(1024) <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

-- 3. Immediately revoke the default PUBLIC EXECUTE grant, then grant only service_role.
--    PostgreSQL grants EXECUTE to PUBLIC on CREATE FUNCTION.  Relying on revoke-before-drop
--    from step 1 is insufficient for a fresh creation path.  Revoking PUBLIC first is safe
--    (no-op if already revoked); revoking anon/authenticated is a no-op here but keeps
--    the pattern uniform with the rest of the project.  Finally grant to service_role.
REVOKE ALL ON FUNCTION public.match_knowledge_items(vector, double precision, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_knowledge_items(vector, double precision, integer) FROM anon;
REVOKE ALL ON FUNCTION public.match_knowledge_items(vector, double precision, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_items(vector, double precision, integer) TO service_role;

-- 4. Idempotent re-apply of search_path (already set inline in step 2; safe to re-run).
--    This ensures the setting survives even if the function body is later
--    CREATE OR REPLACE'd without an explicit SET clause.
ALTER FUNCTION public.match_knowledge_items(vector, double precision, integer)
  SET search_path = pg_catalog, public;

-- 5. Verify the return column names using pg_proc proargnames/proargmodes.
--    For RETURNS TABLE functions:
--      - proargnames is a text[] holding all argument names in positional order.
--      - proargmodes[i] is the mode for proargnames[i]: 'i'=IN, 'o'=OUT, 'b'=INOUT,
--        'v'=VARIADIC, 't'=TABLE.  For RETURNS TABLE, every result column has mode 't'.
--    Uses to_regprocedure() for exact OID resolution.
--    Fails with RAISE EXCEPTION on any mismatch.
DO $$
DECLARE
  expected_cols  text[] := ARRAY[
    'knowledge_item_id', 'chunk_id', 'chunk_index', 'content_hash',
    'content', 'name', 'category', 'similarity'
  ];
  actual_cols   text[];
  fn_oid        oid;
  i             int;
BEGIN
  fn_oid := to_regprocedure('public.match_knowledge_items(vector,double precision,integer)');
  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'match_knowledge_items not found after CREATE';
  END IF;

  -- Extract TABLE-column names (proargmodes[i] = 't') in positional order.
  -- Use a CTE to avoid repeated pg_proc scans.
  WITH fn AS (
    SELECT p.pronargs, p.proargmodes, p.proargnames
    FROM pg_proc p
    WHERE p.oid = fn_oid
  )
  SELECT ARRAY(
    SELECT (fn.proargnames)[gs.idx]::text
    FROM generate_subscripts(fn.proargnames, 1) WITH ORDINALITY AS gs(idx)
    WHERE fn.proargmodes[gs.idx] = 't'
    ORDER BY gs.idx
  ) INTO actual_cols
  FROM fn;

  -- NULL actual_cols means the proargmodes check returned no rows; IS DISTINCT FROM
  -- handles NULL correctly (NULL IS DISTINCT FROM 8 → TRUE), unlike <> which is NULL.
  IF actual_cols IS NULL OR cardinality(actual_cols) IS DISTINCT FROM cardinality(expected_cols) THEN
    RAISE EXCEPTION 'Column count mismatch: expected %, got %',
      cardinality(expected_cols), COALESCE(cardinality(actual_cols), -1);
  END IF;

  FOR i IN 1..cardinality(expected_cols) LOOP
    IF actual_cols[i] IS DISTINCT FROM expected_cols[i] THEN
      RAISE EXCEPTION
        'Column name mismatch at position %: expected "%", got "%"',
        i, expected_cols[i], COALESCE(actual_cols[i], '(NULL)');
    END IF;
  END LOOP;

  RAISE NOTICE 'Return columns verified: %', actual_cols;
END $$;

-- 6. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload';

-- 7. Smoke test: verify the function is callable and returns non-NULL knowledge_item_id.
--    Uses explicit-column SELECT INTO (no %ROWTYPE against a function).
--    Exceptions propagate and abort the migration.  Only the no-data skip is silent.
DO $$
DECLARE
  v_knowledge_item_id text;
  v_chunk_id          text;
  v_chunk_index       int;
  v_content_hash     text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.knowledge_items
    WHERE status = 'active' AND embedding IS NOT NULL
    LIMIT 1
  ) THEN
    RAISE NOTICE 'Smoke test SKIPPED: no active knowledge items with embeddings.';
    RETURN;
  END IF;

  -- r.similarity intentionally omitted from SELECT — not needed for verification.
  SELECT
    r.knowledge_item_id,
    r.chunk_id,
    r.chunk_index,
    r.content_hash
  INTO
    v_knowledge_item_id,
    v_chunk_id,
    v_chunk_index,
    v_content_hash
  FROM public.match_knowledge_items(
    (SELECT embedding::vector(1024) FROM public.knowledge_items
     WHERE status = 'active' AND embedding IS NOT NULL LIMIT 1),
    0.0,
    1
  ) AS r
  LIMIT 1;

  IF v_knowledge_item_id IS NULL THEN
    RAISE EXCEPTION 'Smoke test FAILED: knowledge_item_id is NULL after function call.';
  END IF;

  RAISE NOTICE
    'Smoke test PASSED: knowledge_item_id=%, chunk_id=%, chunk_index=%, content_hash_present=%',
    v_knowledge_item_id, v_chunk_id, v_chunk_index, v_content_hash IS NOT NULL;
END $$;

-- SmartAssist Ollama Embedding Migration
-- pgvector extension (Supabase already has it, skip if error)
-- CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Add embedding columns (1024 dimensions for mxbai-embed-large)
-- Stored as text (JSON array string) for Supabase schema compatibility.
-- RPC functions cast to vector(1024) at query time.
ALTER TABLE knowledge_items   ADD COLUMN IF NOT EXISTS embedding text;
ALTER TABLE product_details   ADD COLUMN IF NOT EXISTS embedding text;
ALTER TABLE size_charts       ADD COLUMN IF NOT EXISTS embedding text;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding text;

-- 2. Create HNSW indexes for fast vector search
CREATE INDEX IF NOT EXISTS knowledge_items_embedding_idx
  ON knowledge_items USING hnsw ((embedding::vector(1024)) vector_cosine_ops);

CREATE INDEX IF NOT EXISTS product_details_embedding_idx
  ON product_details USING hnsw ((embedding::vector(1024)) vector_cosine_ops);

CREATE INDEX IF NOT EXISTS size_charts_embedding_idx
  ON size_charts USING hnsw ((embedding::vector(1024)) vector_cosine_ops);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw ((embedding::vector(1024)) vector_cosine_ops);

-- 3. RPC: match_knowledge_items
-- Parameter: vector(1024) so Supabase JS client passes JS number[] directly.
-- Internal COALESCE casts text→vector for each row's stored embedding.
CREATE OR REPLACE FUNCTION match_knowledge_items(
  p_query_embedding  vector(1024),
  p_match_threshold  float8,
  p_match_count      int
)
RETURNS TABLE (
  id          text,
  content     text,
  name        text,
  category    text,
  chunk_index int,
  similarity  float8
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ki.id,
    COALESCE(kc.content, ki.content) AS content,
    ki.name,
    COALESCE(ki.category, '未分类') AS category,
    COALESCE((kc.chunk_index)::int, 0) AS chunk_index,
    (1::float8 - (COALESCE(kc.embedding, ki.embedding)::vector(1024) <=> p_query_embedding)) AS similarity
  FROM knowledge_items ki
  LEFT JOIN knowledge_chunks kc ON kc.knowledge_item_id = ki.id
  WHERE ki.status = 'active'
    AND COALESCE(kc.embedding, ki.embedding)::vector(1024) IS NOT NULL
    AND 1::float8 - (COALESCE(kc.embedding, ki.embedding)::vector(1024) <=> p_query_embedding) >= p_match_threshold
  ORDER BY COALESCE(kc.embedding, ki.embedding)::vector(1024) <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

-- 4. RPC: match_product_details
CREATE OR REPLACE FUNCTION match_product_details(
  p_query_embedding  vector(1024),
  p_match_threshold  float8,
  p_match_count      int
)
RETURNS TABLE (
  id         text,
  name       text,
  sku        text,
  category   text,
  similarity float8
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    pd.id, pd.name, pd.sku, COALESCE(pd.category, '未分类') AS category,
    (1::float8 - (pd.embedding::vector(1024) <=> p_query_embedding)) AS similarity
  FROM product_details pd
  WHERE pd.embedding::vector(1024) IS NOT NULL
    AND 1::float8 - (pd.embedding::vector(1024) <=> p_query_embedding) >= p_match_threshold
  ORDER BY pd.embedding::vector(1024) <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

-- 5. RPC: match_size_charts
CREATE OR REPLACE FUNCTION match_size_charts(
  p_query_embedding  vector(1024),
  p_match_threshold  float8,
  p_match_count      int
)
RETURNS TABLE (
  id         text,
  name       text,
  category   text,
  chart_type text,
  similarity float8
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id, sc.name, COALESCE(sc.category, '未分类') AS category,
    COALESCE(sc.chart_type, 'custom') AS chart_type,
    (1::float8 - (sc.embedding::vector(1024) <=> p_query_embedding)) AS similarity
  FROM size_charts sc
  WHERE sc.embedding::vector(1024) IS NOT NULL
    AND 1::float8 - (sc.embedding::vector(1024) <=> p_query_embedding) >= p_match_threshold
  ORDER BY sc.embedding::vector(1024) <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

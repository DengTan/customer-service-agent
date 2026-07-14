// Repair script: create missing pgvector RPC functions in Supabase
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
config({ path: resolve(process.cwd(), '.env') });

const SQL_CREATE_FUNCTIONS = `
CREATE OR REPLACE FUNCTION match_knowledge_items(
  p_query_embedding  vector(1024),
  p_match_threshold  float,
  p_match_count      int
)
RETURNS TABLE (
  id          text,
  content     text,
  name        text,
  category    text,
  chunk_index int,
  similarity  float
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
    1 - (COALESCE(kc.embedding, ki.embedding)::vector(1024) <=> p_query_embedding) AS similarity
  FROM knowledge_items ki
  LEFT JOIN knowledge_chunks kc ON kc.knowledge_item_id = ki.id
  WHERE ki.status = 'active'
    AND COALESCE(kc.embedding, ki.embedding)::vector(1024) IS NOT NULL
    AND 1 - (COALESCE(kc.embedding, ki.embedding)::vector(1024) <=> p_query_embedding) >= p_match_threshold
  ORDER BY COALESCE(kc.embedding, ki.embedding)::vector(1024) <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_product_details(
  p_query_embedding  vector(1024),
  p_match_threshold  float,
  p_match_count      int
)
RETURNS TABLE (
  id         text,
  name       text,
  sku        text,
  category   text,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    pd.id, pd.name, pd.sku, COALESCE(pd.category, '未分类') AS category,
    1 - (pd.embedding::vector(1024) <=> p_query_embedding) AS similarity
  FROM product_details pd
  WHERE pd.embedding::vector(1024) IS NOT NULL
    AND 1 - (pd.embedding::vector(1024) <=> p_query_embedding) >= p_match_threshold
  ORDER BY pd.embedding::vector(1024) <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_size_charts(
  p_query_embedding  vector(1024),
  p_match_threshold  float,
  p_match_count      int
)
RETURNS TABLE (
  id         text,
  name       text,
  category   text,
  chart_type text,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id, sc.name, COALESCE(sc.category, '未分类') AS category,
    COALESCE(sc.chart_type, 'custom') AS chart_type,
    1 - (sc.embedding::vector(1024) <=> p_query_embedding) AS similarity
  FROM size_charts sc
  WHERE sc.embedding::vector(1024) IS NOT NULL
    AND 1 - (sc.embedding::vector(1024) <=> p_query_embedding) >= p_match_threshold
  ORDER BY sc.embedding::vector(1024) <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;
`;

(async () => {
  const supabase = getSupabaseClient();

  console.log('--- 检查 Supabase 中是否已有 exec RPC ---');
  const { error: execCheckErr } = await supabase.rpc('exec', { sql: 'SELECT 1' });
  console.log(execCheckErr ? `exec 不可用: ${execCheckErr.message}` : 'exec 可用');

  console.log('\n--- 尝试通过 supabase.rpc("exec") 一次性执行多语句 ---');
  const { error: bulkErr } = await supabase.rpc('exec', { sql: SQL_CREATE_FUNCTIONS });
  if (bulkErr) {
    console.log('  bulk exec 失败:', bulkErr.message);
  } else {
    console.log('  bulk exec 成功');
  }

  // 直接验：调用 match_knowledge_items
  console.log('\n--- 验证 match_knowledge_items 是否生效 ---');
  const fakeVec = new Array(1024).fill(0);
  const { data, error } = await supabase.rpc('match_knowledge_items', {
    p_query_embedding: fakeVec,
    p_match_threshold: 0,
    p_match_count: 5,
  });
  if (error) {
    console.log('  ERROR:', error.message);
  } else {
    console.log(`  OK, returned ${data?.length || 0} rows`);
    if (data?.length) console.log('  sample:', JSON.stringify(data[0], null, 2));
  }
})();
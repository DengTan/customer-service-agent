// Quick diagnostic script — verify knowledge base vectorization status
// Load .env so SUPABASE_URL / SUPABASE_ANON_KEY are available
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
config({ path: resolve(process.cwd(), '.env') });

(async () => {
  const supabase = getSupabaseClient();

  console.log('=== 1. knowledge_items 最新 5 条 ===');
  const { data: items, error: itemsErr } = await supabase
    .from('knowledge_items')
    .select('id, name, type, chunk_count, status, hit_count, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  if (itemsErr) console.log('  ERROR:', itemsErr.message);
  else console.log(JSON.stringify(items, null, 2));

  console.log('\n=== 2. 退换货政策 074e2187 的 knowledge_items ===');
  const { data: item } = await supabase
    .from('knowledge_items')
    .select('id, name, type, chunk_count, content_hash, status, created_at')
    .eq('id', '6f2d57ce-993d-40c5-a201-684df889dd28')
    .maybeSingle();
  console.log(item || 'NOT FOUND');

  console.log('\n=== 3. knowledge_chunks 数量 ===');
  const { count: chunkTotal } = await supabase
    .from('knowledge_chunks')
    .select('id', { count: 'exact', head: true });
  console.log('  total chunks:', chunkTotal);

  console.log('\n=== 4. 退换货政策对应的 chunks ===');
  const { data: chunks, error: chunksErr } = await supabase
    .from('knowledge_chunks')
    .select('id, chunk_index, content_hash, version_added, version_removed')
    .eq('knowledge_item_id', '6f2d57ce-993d-40c5-a201-684df889dd28')
    .order('chunk_index');
  if (chunksErr) console.log('  ERROR:', chunksErr.message);
  else console.log(JSON.stringify(chunks, null, 2));

  console.log('\n=== 5. knowledge_items 是否有 embedding 列 ===');
  // 检查 embedding 字段是否存储了向量
  const { data: embeddingCheck } = await supabase
    .from('knowledge_items')
    .select('id, name, embedding')
    .eq('id', '6f2d57ce-993d-40c5-a201-684df889dd28')
    .maybeSingle();
  if (embeddingCheck) {
    console.log('  embedding column exists:', embeddingCheck.embedding !== undefined);
    console.log('  embedding type:', typeof embeddingCheck.embedding);
    console.log('  embedding is null:', embeddingCheck.embedding === null);
    console.log('  embedding is empty string:', embeddingCheck.embedding === '');
    if (typeof embeddingCheck.embedding === 'string') {
      console.log('  embedding length:', embeddingCheck.embedding.length);
      console.log('  embedding preview:', embeddingCheck.embedding.slice(0, 80) + '...');
    }
  }

  console.log('\n=== 6. 检查 RPC match_knowledge_items 是否存在 ===');
  // 用一个零向量试调用 — 期望返回空数组但不会报错
  const fakeVec = new Array(1024).fill(0);
  const { data: rpcData, error: rpcErr } = await supabase.rpc('match_knowledge_items', {
    p_query_embedding: fakeVec,
    p_match_threshold: 0,
    p_match_count: 5,
  });
  if (rpcErr) console.log('  RPC ERROR:', rpcErr.message, '\n  Hint:', rpcErr.hint || '');
  else console.log('  RPC OK, returned rows:', rpcData?.length, rpcData?.slice(0, 2));

  console.log('\n=== 7. 全部 knowledge_items 的 chunk_count 统计 ===');
  const { data: stats } = await supabase
    .from('knowledge_items')
    .select('chunk_count, embedding')
    .eq('status', 'active');
  if (stats) {
    const noChunks = stats.filter((s: { chunk_count?: number }) => !s.chunk_count || s.chunk_count === 0).length;
    const noEmbedding = stats.filter((s: { embedding?: unknown }) => !s.embedding).length;
    console.log('  total active items:', stats.length);
    console.log('  items with chunk_count=0:', noChunks);
    console.log('  items with NULL embedding:', noEmbedding);
  }
})();
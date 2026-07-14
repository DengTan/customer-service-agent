// Test match_knowledge_items RPC after SQL fix
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
config({ path: resolve(process.cwd(), '.env') });

(async () => {
  const supabase = getSupabaseClient();

  // 1. 查 pgvector 扩展
  console.log('--- 1. pgvector 扩展 ---');
  const { data: ext } = await supabase.from('pg_extension').select('extname').ilike('extname', 'vector');
  console.log(ext ? `已启用: ${JSON.stringify(ext)}` : '未找到扩展（可能需要刷新 schema cache）');

  // 2. 调 RPC
  console.log('\n--- 2. match_knowledge_items RPC ---');
  const ollamaResp = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mxbai-embed-large', prompt: '退货 流程 怎么操作' }),
  });
  const { embedding: vec } = await ollamaResp.json();
  console.log(`  Ollama vec length: ${vec?.length}`);

  const { data, error } = await supabase.rpc('match_knowledge_items', {
    p_query_embedding: vec,
    p_match_threshold: 0.0,
    p_match_count: 5,
  });
  if (error) {
    console.log(`  ERROR: ${error.message}`);
  } else {
    console.log(`  OK, 返回 ${data?.length} 条结果:`);
    for (const r of data || []) {
      console.log(`    相似度=${r.similarity?.toFixed(4)}  资料=${r.name}  内容=${r.content?.slice(0, 60)}...`);
    }
  }
})();
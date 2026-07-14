// End-to-end test: emulate what /api/knowledge does
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
config({ path: resolve(process.cwd(), '.env') });

(async () => {
  const supabase = getSupabaseClient();

  // 1. 用 Ollama 把 "退货 流程" 转向量
  console.log('--- 1. 调用 Ollama 把查询转向量 ---');
  const ollamaResp = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mxbai-embed-large', prompt: '退货 流程 怎么操作' }),
  });
  const ollamaJson = await ollamaResp.json();
  const queryVec = ollamaJson.embedding;
  console.log(`  query vec length: ${queryVec?.length}`);

  // 2. 用一个临时的 SQL 函数占位查 embedding 列 — 如果 RPC 不在，看能否手动 SQL 查询
  console.log('\n--- 2. 直接在 knowledge_items 上做相似度排序（手工 cast） ---');
  // 先看能 SELECT embedding 字段
  const { data: rows, error: rowsErr } = await supabase
    .from('knowledge_items')
    .select('id, name, embedding, status')
    .eq('status', 'active')
    .not('embedding', 'is', null);
  console.log(rowsErr ? `ERR: ${rowsErr.message}` : `OK, ${rows?.length} rows with embedding`);

  // 3. 算下客户端 cosine similarity (workaround RPC 缺失)
  if (rows && rows.length) {
    function parseEmbedding(s: unknown) {
      if (!s) return null;
      try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
    }
    function cosine(a: number[], b: number[]) {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
    const scored = rows
      .map((r: { id: string; name: string; embedding: unknown }) => {
        const emb = parseEmbedding(r.embedding);
        return emb ? { id: r.id, name: r.name, score: cosine(queryVec, emb) } : null;
      })
      .filter((item): item is { id: string; name: string; score: number } => item !== null)
      .sort((a, b) => b.score - a.score);
    console.log('\n  客户端余弦相似度 top 5:');
    for (const s of scored.slice(0, 5)) {
      console.log(`    ${s.score.toFixed(4)}  ${s.name}  (${s.id})`);
    }
  }
})();
// Verify connectivity & which tables/functions exist
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
config({ path: resolve(process.cwd(), '.env') });

(async () => {
  const supabase = getSupabaseClient();

  // 1. 验证 basic SELECT
  console.log('--- 1. SELECT 1 from settings ---');
  const { data: s, error: sErr } = await supabase.from('settings').select('key, value').limit(3);
  console.log(sErr ? `ERR: ${sErr.message}` : `OK, ${s?.length} rows`);

  // 2. 列出知识库相关 RPC 函数（通过 information_schema）
  console.log('\n--- 2. 查询 information_schema.routines ---');
  const { data: routines, error: rErr } = await supabase
    .rpc('exec', { sql: "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'match_%'" })
    .select('*');
  console.log(rErr ? `ERR: ${rErr.message}` : `routines: ${JSON.stringify(routines)}`);

  // 3. 看看是否存在 content_sensitive_words 表
  console.log('\n--- 3. Check content_sensitive_words table ---');
  const { data: csw, error: cswErr } = await supabase.from('content_sensitive_words').select('id').limit(1);
  console.log(cswErr ? `ERR: ${cswErr.message}` : `OK, ${csw?.length} rows`);

  // 4. 看 Supabase 的 DB 版本和 pgvector 扩展
  console.log('\n--- 4. Check pgvector extension ---');
  const { data: ext, error: extErr } = await supabase
    .rpc('exec', { sql: "SELECT extname FROM pg_extension WHERE extname='vector'" })
    .select('*');
  console.log(extErr ? `ERR: ${extErr.message}` : `extensions: ${JSON.stringify(ext)}`);
})();
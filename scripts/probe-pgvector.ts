// Probe whether pgvector extension is enabled
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
config({ path: resolve(process.cwd(), '.env') });

(async () => {
  const supabase = getSupabaseClient();

  // Try querying pg_extension directly via REST (won't work because not exposed)
  // Instead, try to detect via information_schema — but supabase-js can't run arbitrary SQL.
  // Try the simpler test: read knowledge_items.embedding and see if it casts work.
  // The truth is: the previous run got "type vector does not exist", so we know vector isn't loaded.

  // Confirm by attempting via different RPC approaches
  console.log('--- Approach 1: Try supabase.rpc("exec") ---');
  const { error: e1 } = await supabase.rpc('exec', { sql: 'SELECT extname FROM pg_extension' });
  console.log(e1 ? `ERR: ${e1.message}` : 'OK');

  console.log('\n--- Approach 2: Check if there is any pgvector-related function already ---');
  const { error: e2 } = await supabase.rpc('match_knowledge_items', {
    p_query_embedding: new Array(1024).fill(0),
    p_match_threshold: 0,
    p_match_count: 1,
  });
  console.log(e2 ? `ERR: ${e2.message}` : 'OK');

  console.log('\n--- Conclusion: ---');
  console.log('  - pgvector extension is NOT enabled (the user got "type vector does not exist")');
  console.log('  - match_knowledge_items is NOT created');
  console.log('  - Need to run CREATE EXTENSION + CREATE FUNCTION via Supabase SQL Editor');
})();
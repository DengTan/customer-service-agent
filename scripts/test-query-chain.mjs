#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Load .env.local
dotenv.config({ path: join(projectRoot, '.env.local') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const client = createClient(url, key);

console.log('Testing query chain with multiple .or() calls...\n');

// Simulate the applyFilters logic
let query = client
  .from('knowledge_items')
  .select('*')
  .neq('status', 'deleted');

console.log('Step 1: Initial query created');
console.log('Query type:', typeof query);
console.log('Has .order method?', typeof query.order === 'function');

// Apply archive filter
query = query.is('archived_at', null);
console.log('\nStep 2: After .is("archived_at", null)');
console.log('Query type:', typeof query);
console.log('Has .order method?', typeof query.order === 'function');

// Apply expires filter (first .or())
query = query.or('expires_at.is.null,expires_at.gt.now()');
console.log('\nStep 3: After first .or()');
console.log('Query type:', typeof query);
console.log('Has .order method?', typeof query.order === 'function');

// Apply search filter (second .or())
query = query.or('name.ilike.%test%,title.ilike.%test%,content.ilike.%test%');
console.log('\nStep 4: After second .or()');
console.log('Query type:', typeof query);
console.log('Has .order method?', typeof query.order === 'function');

// Try to chain .order()
try {
  query = query.order('archived_at', { ascending: true }).order('created_at', { ascending: false });
  console.log('\nStep 5: After .order() calls');
  console.log('✅ .order() succeeded');
  console.log('Query type:', typeof query);
  console.log('Has .range method?', typeof query.range === 'function');
} catch (err) {
  console.error('\n❌ .order() failed:', err.message);
  process.exit(1);
}

// Try to chain .range()
try {
  query = query.range(0, 19);
  console.log('\nStep 6: After .range(0, 19)');
  console.log('✅ .range() succeeded');
  console.log('Query type:', typeof query);
} catch (err) {
  console.error('\n❌ .range() failed:', err.message);
  process.exit(1);
}

console.log('\n✅ All query chaining succeeded! The query builder is working correctly.');

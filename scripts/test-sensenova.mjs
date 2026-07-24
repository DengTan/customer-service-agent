/**
 * Quick test script to verify Sensenova API connection
 * Run with: node --require ./scripts/asls-bootstrap.cjs -e "$(cat scripts/test-sensenova.mjs)"
 */
import './scripts/asls-bootstrap.cjs';
import { safeDecrypt } from './src/lib/crypto.ts';
import { getSupabaseClient } from './src/storage/database/supabase-client.ts';

async function testConnection() {
  const supabase = getSupabaseClient();

  // 1. Get the provider
  const { data: provider, error } = await supabase
    .from('llm_providers')
    .select('*')
    .eq('id', 'sensenova-provider')
    .single();

  if (error || !provider) {
    console.error('Failed to get provider:', error);
    return;
  }

  console.log('Provider:', provider.display_name);
  console.log('Base URL:', provider.base_url);
  console.log('Default Model:', provider.default_model);
  console.log('Encrypted API Key:', provider.api_key?.slice(0, 20) + '...');

  // 2. Try to decrypt the API key
  let apiKey;
  if (provider.api_key && !provider.api_key.includes('***') && !provider.api_key.startsWith('http')) {
    try {
      apiKey = safeDecrypt(provider.api_key);
      console.log('Decrypted API Key:', apiKey?.slice(0, 10) + '...' + apiKey?.slice(-5));
    } catch (err) {
      console.error('Failed to decrypt API key:', err);
      apiKey = provider.api_key; // fallback
    }
  } else {
    console.error('API key is masked or invalid format');
    return;
  }

  // 3. Test the API
  console.log('\nTesting API connection...');

  try {
    // Normalize base URL to avoid double-slash issues
    const baseUrl = provider.base_url.replace(/\/$/, '');
    const endpoint = baseUrl.endsWith('/v1/chat/completions')
      ? baseUrl
      : baseUrl.endsWith('/v1')
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.default_model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
    });

    const data = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', data);

    if (response.ok) {
      console.log('\n✅ Connection successful!');
    } else {
      console.log('\n❌ Connection failed');
    }
  } catch (err) {
    console.error('Request failed:', err);
  }
}

testConnection().catch(console.error);

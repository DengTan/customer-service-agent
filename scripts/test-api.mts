/**
 * Test Sensenova API connection with correct environment loading
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Inline decryption (same as crypto.ts)
function safeDecrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  if (ciphertext.startsWith('http://') || ciphertext.startsWith('https://')) {
    return ciphertext;
  }
  try {
    return decrypt(ciphertext);
  } catch {
    return ciphertext;
  }
}

function decrypt(ciphertext: string): string {
  const crypto = require('crypto');
  const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY!).digest();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid format');
  const [ivB64, authTagB64, encrypted] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function test() {
  console.log('ENCRYPTION_KEY:', process.env.ENCRYPTION_KEY ? 'loaded' : 'NOT LOADED');
  console.log('NODE_ENV:', process.env.NODE_ENV);

  // Get provider
  const { data: provider } = await supabase
    .from('llm_providers')
    .select('*')
    .eq('id', 'sensenova-provider')
    .single();

  if (!provider) {
    console.error('Provider not found');
    return;
  }

  console.log('Provider:', provider.display_name);
  console.log('Encrypted Key:', provider.api_key?.slice(0, 20) + '...');

  // Decrypt
  const apiKey = safeDecrypt(provider.api_key!);
  console.log('Decrypted Key:', apiKey?.slice(0, 10) + '...' + apiKey?.slice(-5));

  if (apiKey === provider.api_key) {
    console.log('⚠️ Decryption failed!');
    return;
  }

  // Test API
  console.log('\nTesting API...');
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
        model: provider.default_model || 'deepseek-v4-flash',
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
    console.error('Request error:', err);
  }
}

test();

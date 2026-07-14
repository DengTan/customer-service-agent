/**
 * Test LLM Provider loading
 */

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

function getEnvValue(key) {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      if (line.startsWith(key + '=')) {
        return line.substring(key.length + 1).trim();
      }
    }
  } catch (e) {}
  return null;
}

// Simple decrypt for AES-256-GCM
function decrypt(ciphertext) {
  const ENCRYPTION_KEY = 'a8f5f167f44d4964e6c998b82759e7a16dc05a9e3c7e2d0b1f4a6c8d9e0b1f2a';
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext; // Not encrypted format
  
  const [ivB64, authTagB64, encrypted] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return ciphertext; // Decryption failed, return as-is
  }
}

const SERVICE_KEY = getEnvValue('SUPABASE_SERVICE_ROLE_KEY');

async function httpRequest(method, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'avmregjnnsmshwxrwjie.supabase.co',
      port: 443,
      path: '/rest/v1' + path,
      method: method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY
      }
    };
    
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch {
          resolve(responseBody);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('Testing LLM Provider Loading...\n');
  
  // Get settings
  console.log('1. Getting settings...');
  const settings = await httpRequest('GET', '/settings?key=eq.llm_provider_id');
  console.log('   llm_provider_id:', settings[0]?.value);
  const llmProviderId = settings[0]?.value;
  
  if (!llmProviderId) {
    console.log('   ❌ llm_provider_id not set!');
    return;
  }
  
  if (llmProviderId === 'coze') {
    console.log('   ⚠️  llm_provider_id is "coze", skipping extended provider check');
    return;
  }
  
  // Get provider
  console.log('\n2. Getting provider by ID...');
  const provider = await httpRequest('GET', `/llm_providers?id=eq.${llmProviderId}-provider`);
  console.log('   Provider:', provider[0] ? provider[0].name : 'NOT FOUND');
  
  if (!provider[0]) {
    console.log('   ❌ Provider not found!');
    return;
  }
  
  // Try decrypting API key
  console.log('\n3. Decrypting API key...');
  const apiKey = provider[0].api_key;
  console.log('   Original API key:', apiKey ? apiKey.substring(0, 20) + '...' : 'null');
  
  const decryptedKey = decrypt(apiKey);
  console.log('   Decrypted API key:', decryptedKey ? decryptedKey.substring(0, 20) + '...' : 'null');
  
  // Test the provider
  console.log('\n4. Testing Sensenova API...');
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'sensenova-6.7-flash-lite',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 10
    });
    
    const options = {
      hostname: 'token.sensenova.cn',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + decryptedKey
      }
    };
    
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        console.log('   Status:', res.statusCode);
        console.log('   Response:', responseBody.substring(0, 200));
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.log('   ❌ Error:', e.message);
      resolve();
    });
    
    req.write(body);
    req.end();
  });
}

main();

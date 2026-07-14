/**
 * Set Sensenova base URL without /v1
 */

const https = require('https');
const fs = require('fs');

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

const SERVICE_KEY = getEnvValue('SUPABASE_SERVICE_ROLE_KEY');

function httpRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'avmregjnnsmshwxrwjie.supabase.co',
      port: 443,
      path: '/rest/v1' + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        Prefer: 'return=representation'
      }
    };
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, data: responseBody }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Setting Sensenova base_url to https://token.sensenova.cn (no /v1) ...\n');
  const updateResult = await httpRequest('PATCH', '/llm_providers?id=eq.sensenova-provider', { base_url: 'https://token.sensenova.cn' });
  console.log('Update result:', updateResult.status);
  const verifyResult = await httpRequest('GET', '/llm_providers?name=eq.sensenova');
  console.log('Verified base_url:', verifyResult.data?.[0]?.base_url);
  if (verifyResult.data?.[0]?.base_url === 'https://token.sensenova.cn') {
    console.log('\n✅ base_url set to https://token.sensenova.cn (adapter will append /v1/chat/completions)');
  }
}
main();

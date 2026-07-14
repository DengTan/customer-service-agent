/**
 * Set llm_provider_id in settings table
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
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Prefer': 'return=representation'
      }
    };
    
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
        } catch {
          resolve({ status: res.statusCode, data: responseBody });
        }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Setting llm_provider_id in settings table...\n');
  
  // Try to update existing record first
  console.log('1. Checking if llm_provider_id exists...');
  const getResult = await httpRequest('GET', '/settings?key=eq.llm_provider_id', null);
  
  if (getResult.data && getResult.data.length > 0) {
    console.log('   Found existing record, updating...');
    const updateResult = await httpRequest('PATCH', '/settings?key=eq.llm_provider_id', {
      value: 'sensenova'
    });
    console.log('   Update result:', updateResult.status);
  } else {
    console.log('   Not found, creating new record...');
    const insertResult = await httpRequest('POST', '/settings', {
      key: 'llm_provider_id',
      value: 'sensenova'
    });
    console.log('   Insert result:', insertResult.status);
  }
  
  // Verify
  console.log('\n2. Verifying...');
  const verifyResult = await httpRequest('GET', '/settings?key=eq.llm_provider_id', null);
  console.log('   Current value:', JSON.stringify(verifyResult.data));
  
  if (verifyResult.data && verifyResult.data[0]?.value === 'sensenova') {
    console.log('\n✅ llm_provider_id set to "sensenova" successfully!');
  } else {
    console.log('\n❌ Failed to set llm_provider_id');
  }
}

main();

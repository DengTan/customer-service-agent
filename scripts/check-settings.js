/**
 * Check all AI-related settings
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

function httpRequest(method, path) {
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
  console.log('Checking AI Settings...\n');
  
  // Check settings table for all AI-related settings
  console.log('1. Checking settings table for AI-related keys...');
  const settings = await httpRequest('GET', '/settings?select=key,value');
  console.log('   All settings:', JSON.stringify(settings, null, 2));
  
  // Check specifically for llm_provider_id
  const llmProviderSetting = settings?.find(s => s.key === 'llm_provider_id');
  console.log('\n2. llm_provider_id setting:', llmProviderSetting);
  
  if (!llmProviderSetting) {
    console.log('\n   ⚠️  llm_provider_id is NOT set in settings!');
    console.log('   This means the provider config block is skipped.');
    console.log('   Need to set llm_provider_id = "sensenova" in settings table.');
  }
}

main();

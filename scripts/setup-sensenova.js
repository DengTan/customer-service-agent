/**
 * Sensenova Provider Update Script
 * Run: node scripts/setup-sensenova.js --update-key
 * 
 * Updates the Sensenova provider with the actual API key
 */

const https = require('https');
const fs = require('fs');

// Read .env file to get actual keys
function getEnvValue(key) {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      if (line.startsWith(key + '=')) {
        return line.substring(key.length + 1).trim();
      }
    }
  } catch (e) {
    // .env not found, use defaults
  }
  return null;
}

const SUPABASE_URL = getEnvValue('SUPABASE_URL') || 'https://avmregjnnsmshwxrwjie.supabase.co';
const SERVICE_KEY = getEnvValue('SUPABASE_SERVICE_ROLE_KEY');

if (!SERVICE_KEY) {
  console.error('Could not read SUPABASE_SERVICE_ROLE_KEY from .env file');
  process.exit(1);
}

// Sensenova API Key from user
const SENSENOVA_API_KEY = 'sk-o2uUmYM8Qbzo6NSV3PvKamRElMZEk4H9';

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
  console.log('Updating Sensenova Provider with API Key...\n');
  
  try {
    // First get the current provider
    console.log('1. Getting current provider...');
    const getResult = await httpRequest('GET', '/llm_providers?name=eq.sensenova', null);
    
    if (getResult.status === 200 && getResult.data && getResult.data.length > 0) {
      const provider = getResult.data[0];
      console.log('   Found provider:', provider.display_name);
      console.log('   Current API Key:', provider.api_key ? '***' + provider.api_key.slice(-4) : '(not set)');
      
      // Update with API key
      console.log('\n2. Updating API Key...');
      const updateResult = await httpRequest('PATCH', '/llm_providers?id=eq.sensenova-provider', {
        api_key: SENSENOVA_API_KEY
      });
      
      if (updateResult.status === 200 || updateResult.status === 204) {
        console.log('   ✅ API Key updated successfully!');
      } else {
        console.log('   ⚠️  Update result:', updateResult.status, updateResult.data);
      }
    } else {
      console.log('   ❌ Provider not found');
    }
    
    console.log('\n✅ Sensenova provider is ready to use!');
    console.log('\n📝 Next steps:');
    console.log('1. Go to Settings → AI Settings in the web interface');
    console.log('2. Find "Sensenova (稀宇科技)" provider');
    console.log('3. Click the checkmark to use Sensenova as the active provider');
    console.log('4. Test the connection with the test button');
    
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();

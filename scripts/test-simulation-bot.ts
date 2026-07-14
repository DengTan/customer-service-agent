// Test API directly
const https = require('https');

const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bXJlZ2pubnNtc2h3eHJ3amllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjUwOTM3MiwiZXhwIjoyMDk4MDg1MzcyfQ.Wd8gaFZ10f8rq68DeKs263SC1-hlTO4el-MjtqTWQD0';

async function query(table, params = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://avmregjnnsmshwxrwjie.supabase.co/rest/v1/${table}?${params}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function insert(table, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://avmregjnnsmshwxrwjie.supabase.co/rest/v1/${table}`);
    const body = JSON.stringify(data);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('Insert status:', res.statusCode);
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // Check bots first
  console.log('=== Checking bots ===');
  const bots = await query('bot_configs?select=id,name&status=eq.active&limit=5');
  console.log('Bots:', JSON.stringify(bots, null, 2));
  
  if (!bots || bots.length === 0) {
    console.log('No bots found!');
    return;
  }
  
  const testBot = bots[0];
  
  // Create a test conversation directly via Supabase
  console.log('\n=== Creating test conversation ===');
  const now = new Date().toISOString();
  const convId = `test-${Date.now()}`;
  
  const newConv = await insert('simulation_conversations', {
    id: convId,
    title: `测试 - ${new Date().toLocaleTimeString('zh-CN')}`,
    scenario_id: 'order_inquiry',
    scenario_name: '订单查询',
    bot_id: testBot.id,
    bot_name: testBot.name,
    status: 'active',
    message_count: 0,
    created_by: 'test-user',
    created_at: now,
    updated_at: now
  });
  
  console.log('Created conversation:', JSON.stringify(newConv, null, 2));
  
  // Verify
  console.log('\n=== Verifying ===');
  const verifications = await query(`simulation_conversations?id=eq.${convId}&select=id,title,bot_id,bot_name`);
  console.log('Verification:', JSON.stringify(verifications, null, 2));
}

main().catch(console.error);

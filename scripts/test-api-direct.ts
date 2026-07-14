// Test POST /api/simulations directly
const https = require('https');

const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bXJlZ2pubnNtc2h3eHJ3amllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjUwOTM3MiwiZXhwIjoyMDk4MDg1MzcyfQ.Wd8gaFZ10f8rq68DeKs263SC1-hlTO4el-MjtqTWQD0';

async function main() {
  const convId = `api-test-${Date.now()}`;
  
  // First, get a JWT token from login
  const loginData = JSON.stringify({
    email: 'admin@smartassist.com',
    password: 'Admin123456'
  });
  
  const loginOptions = {
    hostname: 'avmregjnnsmshwxrwjie.supabase.co',
    path: '/auth/v1/token?grant_type=password',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey
    }
  };
  
  const loginRes = await new Promise((resolve, reject) => {
    const req = https.request(loginOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(loginData);
    req.end();
  });
  
  const jwt = loginRes.access_token;
  console.log('Got JWT token:', jwt ? 'yes' : 'no');
  
  // Create simulation conversation
  const createData = JSON.stringify({
    title: `API Test - ${new Date().toLocaleTimeString('zh-CN')}`,
    scenario_id: 'order_inquiry',
    scenario_name: '订单查询',
    bot_id: '00000000-0000-0000-0000-000000000001',
    bot_name: 'SmartAssist 智能客服'
  });
  
  const createOptions = {
    hostname: 'avmregjnnsmshwxrwjie.supabase.co',
    path: '/rest/v1/simulation_conversations',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`, // Using service role for direct insert
      'Prefer': 'return=representation'
    }
  };
  
  const now = new Date().toISOString();
  const directData = [{
    id: convId,
    title: `Direct Test - ${new Date().toLocaleTimeString('zh-CN')}`,
    scenario_id: 'order_inquiry',
    scenario_name: '订单查询',
    bot_id: '00000000-0000-0000-0000-000000000001',
    bot_name: 'SmartAssist 智能客服',
    status: 'active',
    message_count: 0,
    created_by: 'api-test',
    created_at: now,
    updated_at: now
  }];
  
  const directRes = await new Promise((resolve, reject) => {
    const req = https.request(createOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('Direct insert status:', res.statusCode);
        console.log('Direct insert response:', data);
        resolve({ status: res.statusCode, data: data });
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(directData));
    req.end();
  });
  
  // Verify
  const verifyUrl = new URL(`https://avmregjnnsmshwxrwjie.supabase.co/rest/v1/simulation_conversations?id=eq.${convId}`);
  const verifyOptions = {
    hostname: verifyUrl.hostname,
    path: verifyUrl.pathname + verifyUrl.search + '&select=id,title,bot_id,bot_name',
    method: 'GET',
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey
    }
  };
  
  const verifyRes = await new Promise((resolve, reject) => {
    const req = https.request(verifyOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('\nVerification:');
        console.log(JSON.stringify(JSON.parse(data), null, 2));
        resolve(data);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

main().catch(console.error);

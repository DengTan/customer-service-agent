const https = require('https');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

function httpRequest(method, path, key = SERVICE_KEY) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method,
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  console.log('=== 测试 PostgREST ===\n');

  // 1. 测试 / 端点
  console.log('1. GET /');
  const r1 = await httpRequest('GET', '/');
  console.log(`   状态: ${r1.status}`);

  // 2. 测试 /rest/v1/
  console.log('\n2. GET /rest/v1/');
  const r2 = await httpRequest('GET', '/rest/v1/');
  console.log(`   状态: ${r2.status}`);
  console.log(`   内容: ${r2.data.substring(0, 200)}`);

  // 3. 尝试通知 PostgREST 重新加载 schema
  console.log('\n3. 尝试 NOTIFY');
  const { Client } = require('pg');
  const client = new Client({
    connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
  });
  
  try {
    await client.connect();
    
    // 尝试 pg_notify
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log('   ✅ 发送 NOTIFY pgrst');
    
    await client.end();
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
  }

  // 4. 再次测试
  console.log('\n4. 再次测试 /rest/v1/bot_configs');
  const r4 = await httpRequest('GET', '/rest/v1/bot_configs?select=id,name');
  console.log(`   状态: ${r4.status}`);
  console.log(`   数据: ${r4.data}`);
}

test().catch(e => console.error('错误:', e.message));

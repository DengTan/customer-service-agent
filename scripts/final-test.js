const https = require('https');
const { Client } = require('pg');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJhbm9uIn0.Ud02Pbuv5gdh_BhUx0cSmUSsh9fLtxp3VXqRS65AA8E';

async function test() {
  // 先刷新 schema
  const client = new Client({
    connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
  });
  
  try {
    await client.connect();
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log('✅ Schema 已刷新');
    await client.end();
  } catch (e) {
    console.log('刷新失败:', e.message);
  }

  // 等待一下
  await new Promise(r => setTimeout(r, 1000));

  // 测试
  return new Promise((resolve) => {
    const url = new URL('/rest/v1/bot_configs?select=id,name,is_sub_agent', SUPABASE_URL);
    const options = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
      timeout: 15000
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const json = JSON.parse(data);
        console.log('\n=== 结果 ===');
        console.log(`状态: ${res.statusCode}, 数量: ${Array.isArray(json) ? json.length : 'N/A'}`);
        if (Array.isArray(json)) {
          json.forEach(b => console.log(`  - ${b.name} (sub: ${b.is_sub_agent})`));
        }
        resolve();
      });
    });
    req.on('error', console.error);
    req.end();
  });
}

test();

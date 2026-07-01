const https = require('https');
const { Client } = require('pg');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

async function check() {
  console.log('=== 数据源对比 ===\n');

  // 1. Supabase REST API
  console.log('【Supabase REST API】');
  const res = await new Promise((resolve, reject) => {
    const url = new URL('/rest/v1/bot_configs?select=id,name', SUPABASE_URL);
    const options = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject); req.end();
  });
  console.log(`Bot 数量: ${Array.isArray(res.data) ? res.data.length : 'N/A'}`);

  // 2. PostgreSQL 直连
  console.log('\n【PostgreSQL 直连】');
  const pgClient = new Client({
    connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require'
  });
  await pgClient.connect();
  const pgResult = await pgClient.query(`SELECT id, name FROM bot_configs`);
  console.log(`Bot 数量: ${pgResult.rows.length}`);
  await pgClient.end();

  // 3. 检查数据库名称
  console.log('\n【PostgreSQL 数据库名】');
  const pgClient2 = new Client({
    connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require'
  });
  await pgClient2.connect();
  const dbName = await pgClient2.query(`SELECT current_database()`);
  console.log(`数据库名: ${dbName.rows[0].current_database}`);
  await pgClient2.end();

  // 4. 结论
  console.log('\n【结论】');
  console.log(`Supabase REST API: ${Array.isArray(res.data) ? res.data.length : 'N/A'} 个 Bot`);
  console.log(`PostgreSQL 直连: ${pgResult.rows.length} 个 Bot`);
  if (Array.isArray(res.data) && res.data.length !== pgResult.rows.length) {
    console.log('\n⚠️ 数据不一致！它们可能是两个不同的数据库实例。');
    console.log('修复: 需要将 Supabase REST API 和 PostgreSQL 直连指向同一个数据库。');
  } else {
    console.log('\n✅ 数据一致');
  }
}

check().catch(e => console.error('错误:', e.message));

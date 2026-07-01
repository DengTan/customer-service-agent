const https = require('https');
const { Client } = require('pg');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject); req.end();
  });
}

async function verifyDataConsistency() {
  console.log('=== 验证 REST API 与 PostgreSQL 直连数据一致性 ===\n');

  // 1. PostgreSQL 直连查询
  console.log('【1】连接 PostgreSQL 直连...');
  const pgClient = new Client({
    host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'tLk6MwE1qBEt55E57n',
    ssl: { rejectUnauthorized: false }
  });
  
  await pgClient.connect();
  console.log('✓ PostgreSQL 连接成功\n');

  // 2. 获取数据库名
  const dbName = await pgClient.query('SELECT current_database() as db');
  console.log(`数据库名: ${dbName.rows[0].db}\n`);

  // 3. 对比关键表
  const tables = ['bot_configs', 'users', 'conversations', 'alerts', 'tickets'];
  
  console.log('表名'.padEnd(25) + 'REST API'.padEnd(12) + 'PostgreSQL直连'.padEnd(12) + '一致');
  console.log('─'.repeat(60));

  for (const table of tables) {
    try {
      // REST API
      const apiRes = await httpGet(`/rest/v1/${table}?select=id`);
      const apiCount = Array.isArray(apiRes) ? apiRes.length : 0;
      
      // PostgreSQL 直连
      const pgRes = await pgClient.query(`SELECT COUNT(*) as count FROM ${table}`);
      const pgCount = parseInt(pgRes.rows[0].count);
      
      const match = apiCount === pgCount ? '✓' : '⚠️';
      console.log(`${table.padEnd(25)}${apiCount.toString().padEnd(12)}${pgCount.toString().padEnd(12)}${match}`);
    } catch (e) {
      console.log(`${table.padEnd(25)}错误: ${e.message}`);
    }
  }

  // 4. 检查 bot_configs 详细内容
  console.log('\n【2】bot_configs 详细对比:\n');
  
  const apiBots = await httpGet('/rest/v1/bot_configs?select=id,name,is_sub_agent,parent_bot_id&order=is_sub_agent');
  const pgBots = await pgClient.query('SELECT id, name, is_sub_agent, parent_bot_id FROM bot_configs ORDER BY is_sub_agent');
  
  console.log('─'.repeat(80));
  console.log('| ID | Name | is_sub_agent | parent_bot_id |');
  console.log('─'.repeat(80));
  
  for (const bot of [...apiBots, ...pgBots.rows].slice(0, 10)) {
    const parent = bot.parent_bot_id ? '...' + bot.parent_bot_id.slice(-8) : 'null';
    console.log(`| ${bot.id?.slice(0, 8) || 'N/A'} | ${(bot.name || '').slice(0, 15)} | ${bot.is_sub_agent} | ${parent} |`);
  }

  await pgClient.end();
  console.log('\n✓ 验证完成');
}

verifyDataConsistency().catch(e => console.error('错误:', e.message));

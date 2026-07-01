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
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
      timeout: 15000
    };
    const req = https.request(options, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject); req.end();
  });
}

async function check() {
  console.log('=== 多方面排查 Bot 显示问题 ===\n');

  // 1. 检查数据库中的完整数据
  console.log('【1. 数据库数据】');
  const client = new Client({
    connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
  });
  await client.connect();
  
  const bots = await client.query(`
    SELECT id, name, is_sub_agent, parent_bot_id, sub_agent_count, status
    FROM bot_configs
    ORDER BY is_sub_agent DESC, name
  `);
  console.log(`数据库共 ${bots.rows.length} 个 Bot:`);
  bots.rows.forEach(b => {
    console.log(`  - ${b.name} (is_sub: ${b.is_sub_agent}, parent: ${b.parent_bot_id?.slice(-8)}, status: ${b.status})`);
  });
  await client.end();

  // 2. 检查 REST API 返回
  console.log('\n【2. Supabase REST API】');
  const apiData = await httpGet('/rest/v1/bot_configs?select=*&order=is_sub_agent.desc');
  console.log(`API 返回 ${Array.isArray(apiData) ? apiData.length : 'N/A'} 个 Bot:`);
  if (Array.isArray(apiData)) {
    apiData.forEach(b => {
      console.log(`  - ${b.name} (is_sub: ${b.is_sub_agent}, status: ${b.status})`);
    });
  }

  // 3. 检查子 Agent 的 parent_bot_id 是否正确
  console.log('\n【3. 子 Agent parent_bot_id 检查】');
  const subAgents = bots.rows.filter(b => b.is_sub_agent);
  const mainBots = bots.rows.filter(b => !b.is_sub_agent);
  console.log(`主 Bot: ${mainBots.map(b => `${b.name}(${b.id.slice(-8)})`).join(', ')}`);
  console.log(`子 Agent:`);
  subAgents.forEach(sa => {
    const parentExists = mainBots.some(mb => mb.id === sa.parent_bot_id);
    console.log(`  - ${sa.name}: parent=${sa.parent_bot_id?.slice(-8)} ${parentExists ? '✅' : '❌ 无效'}`);
  });

  // 4. 检查前端使用的 API 端点
  console.log('\n【4. 前端 API 测试】');
  // 模拟 /api/sub-agents?main_bots=true
  console.log('前端调用 /api/sub-agents?main_bots=true');
  console.log('应该返回主 Bot 列表，每个包含 sub_agent_count');
  
  // 5. 检查是否有 status 过滤问题
  console.log('\n【5. status 字段检查】');
  const activeBots = bots.rows.filter(b => b.status === 'active');
  const inactiveBots = bots.rows.filter(b => b.status !== 'active');
  console.log(`active: ${activeBots.length}, inactive: ${inactiveBots.length}`);
  
  const activeApi = await httpGet('/rest/v1/bot_configs?select=*&status=eq.active');
  console.log(`API status=active 返回: ${Array.isArray(activeApi) ? activeApi.length : 'N/A'}`);
}

check().catch(e => console.error('错误:', e.message));

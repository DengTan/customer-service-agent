const https = require('https');

// 应用服务器 API（使用 Service Key）
function requestAppApi(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: 5000,
      path: path, method: 'GET'
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject); req.end();
  });
}

// Supabase REST API
function requestSupabase(path, key) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com');
    const options = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
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

const http = require('http');

async function test() {
  console.log('=== 追踪 Bot 显示问题 ===\n');

  // 1. 通过应用 API 获取主 Bot 列表
  console.log('【1. 应用 API: /api/sub-agents?main_bots=true】');
  const mainBots = await requestAppApi('/api/sub-agents?main_bots=true');
  console.log(`状态: ${mainBots.status}`);
  if (mainBots.data.success) {
    console.log(`主 Bot 数量: ${mainBots.data.bots.length}`);
    mainBots.data.bots.forEach(bot => {
      console.log(`  - ${bot.name} (id: ${bot.id})`);
    });
  }

  // 2. 通过 Supabase REST API 获取主 Bot
  console.log('\n【2. Supabase REST API: is_sub_agent=eq.false】');
  const supabaseMainBots = await requestSupabase(
    '/rest/v1/bot_configs?is_sub_agent=eq.false&select=id,name',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8'
  );
  if (Array.isArray(supabaseMainBots)) {
    console.log(`主 Bot 数量: ${supabaseMainBots.length}`);
    supabaseMainBots.forEach(bot => {
      console.log(`  - ${bot.name} (id: ${bot.id})`);
    });
  }

  // 3. 追踪应用 API 使用的 ID
  if (mainBots.data.success && mainBots.data.bots.length > 0) {
    const mainBotId = mainBots.data.bots[0].id;
    console.log(`\n【3. 使用主 Bot ID: ${mainBotId} 查询子 Agent】`);
    
    // 通过 Supabase API 查询该 ID 的子 Agent
    const subAgents = await requestSupabase(
      `/rest/v1/bot_configs?parent_bot_id=eq.${mainBotId}&is_sub_agent=eq.true&select=id,name`,
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8'
    );
    console.log(`子 Agent 数量: ${Array.isArray(subAgents) ? subAgents.length : 'N/A'}`);
    if (Array.isArray(subAgents)) {
      subAgents.forEach(sa => console.log(`  - ${sa.name}`));
    }

    // 4. 通过应用 API 查询子 Agent
    console.log(`\n【4. 应用 API: /api/sub-agents?parent_bot_id=${mainBotId}】`);
    const appSubAgents = await requestAppApi(`/api/sub-agents?parent_bot_id=${mainBotId}`);
    console.log(`状态: ${appSubAgents.status}`);
    if (appSubAgents.data.success) {
      console.log(`子 Agent 数量: ${appSubAgents.data.subAgents?.length || 0}`);
    } else {
      console.log(`错误: ${appSubAgents.data.error}`);
    }
  }

  // 5. 对比：直接查询所有子 Agent
  console.log('\n【5. 直接查询所有子 Agent (REST API)】');
  const allSubAgents = await requestSupabase(
    '/rest/v1/bot_configs?is_sub_agent=eq.true&select=id,name,parent_bot_id',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8'
  );
  if (Array.isArray(allSubAgents)) {
    console.log(`子 Agent 总数: ${allSubAgents.length}`);
    allSubAgents.forEach(sa => {
      console.log(`  - ${sa.name} (parent: ${sa.parent_bot_id?.slice(-8)})`);
    });
  }
}

test().catch(e => console.error('错误:', e.message));

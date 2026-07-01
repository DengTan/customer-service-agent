const https = require('https');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';
const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';

function request(method, path, body, apiKey = SERVICE_KEY) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method,
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(options, res => {
      let responseData = '';
      res.on('data', c => responseData += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseData) }); }
        catch { resolve({ status: res.statusCode, data: responseData }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function fix() {
  console.log('=== 修复子 Agent parent_bot_id ===\n');

  // 正确的主 Bot ID
  const mainBotId = '00000000-0000-0000-0000-000000000001';
  
  // 1. 获取所有子 Agent
  console.log('1. 获取所有子 Agent...');
  const subAgents = await request('GET', '/rest/v1/bot_configs?is_sub_agent=eq.true&select=id,name,parent_bot_id');
  console.log(`   找到 ${Array.isArray(subAgents.data) ? subAgents.data.length : 0} 个子 Agent`);
  
  if (!Array.isArray(subAgents.data)) {
    console.log('   错误:', subAgents.data);
    return;
  }

  // 2. 批量更新 parent_bot_id
  console.log(`\n2. 更新 parent_bot_id 为 ${mainBotId}...`);
  
  // 获取所有子 Agent 的 ID
  const subAgentIds = subAgents.data.map(sa => sa.id);
  
  if (subAgentIds.length > 0) {
    // 构建 UPDATE 请求
    const updatePath = `/rest/v1/bot_configs?id=in.(${subAgentIds.join(',')})`;
    const result = await request('PATCH', updatePath, { parent_bot_id: mainBotId });
    console.log(`   状态: ${result.status}`);
    console.log(`   结果: ${JSON.stringify(result.data)}`);
  }

  // 3. 验证
  console.log('\n3. 验证更新结果...');
  const updated = await request('GET', '/rest/v1/bot_configs?is_sub_agent=eq.true&select=id,name,parent_bot_id');
  if (Array.isArray(updated.data)) {
    console.log(`   子 Agent 数量: ${updated.data.length}`);
    updated.data.forEach(sa => {
      console.log(`   - ${sa.name} (parent: ${sa.parent_bot_id?.slice(-8)})`);
    });
  }

  // 4. 验证主 Bot 的子 Agent 计数
  console.log('\n4. 查询主 Bot 的子 Agent...');
  const mainBotSubAgents = await request('GET', `/rest/v1/bot_configs?parent_bot_id=eq.${mainBotId}&is_sub_agent=eq.true&select=id,name`);
  console.log(`   找到 ${Array.isArray(mainBotSubAgents.data) ? mainBotSubAgents.data.length : 0} 个子 Agent`);
  if (Array.isArray(mainBotSubAgents.data)) {
    mainBotSubAgents.data.forEach(sa => console.log(`   - ${sa.name}`));
  }
}

fix().catch(e => console.error('错误:', e.message));

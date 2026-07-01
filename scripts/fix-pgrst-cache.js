const https = require('https');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000);
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== 尝试触发 PostgREST Schema 刷新 ===\n');
  
  // 1. 尝试通过调用 rpc 函数来触发 schema 重载
  console.log('1. 尝试调用 pg_notify...');
  const pg = require('pg');
  const client = new pg.Client({
    host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'tLk6MwE1qBEt55E57n',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    
    // 发送 pgrst notify
    await client.query("NOTIFY pgrst, 'reload'");
    console.log('   pgrst notify 发送成功');
    
    // 尝试执行 pg_stat_statements 刷新
    await client.query('NOTIFY pgrst, \'schema changed\'');
    console.log('   schema changed notify 发送成功');
    
    await client.end();
  } catch (err) {
    console.log('   pg 操作失败:', err.message);
    if (client) await client.end().catch(() => {});
  }
  
  // 等待
  console.log('\n2. 等待 5 秒让 schema 缓存刷新...');
  await new Promise(r => setTimeout(r, 5000));
  
  // 3. 测试 API
  console.log('\n3. 测试 API /rest/v1/llm_providers...');
  const result = await request('GET', '/rest/v1/llm_providers?select=id,name&limit=5');
  console.log('   状态:', result.status);
  if (result.data && result.data.code) {
    console.log('   错误:', result.data.message);
  } else {
    console.log('   成功! 数据:', JSON.stringify(result.data));
  }
  
  // 4. 尝试获取所有表
  console.log('\n4. 检查数据库中是否有 llm_providers 表...');
  const tables = await request('GET', '/rest/v1/?limit=1');
  console.log('   状态:', tables.status);
  
  // 5. 直接测试 API 端点
  console.log('\n5. 测试 /api/llm-providers (通过 Next.js)...');
  try {
    const response = await fetch('http://localhost:5000/api/llm-providers', {
      headers: {
        'Cookie': 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4ifQ.placeholder'
      }
    });
    const data = await response.json();
    console.log('   状态:', response.status);
    console.log('   提供商数量:', data.providers?.length || 0);
    if (data.providers) {
      data.providers.forEach(p => console.log('   -', p.name, ':', p.display_name));
    }
  } catch (err) {
    console.log('   无法连接本地服务:', err.message);
  }
  
  console.log('\n=== 完成 ===');
  console.log('\n如果 PostgREST 仍然找不到表，您需要:');
  console.log('1. 登录 Supabase Dashboard');
  console.log('2. 进入 SQL Editor');
  console.log('3. 执行: NOTIFY pgrst, \'reload\';');
}

main().catch(console.error);

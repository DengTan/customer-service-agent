const { Client } = require('pg');

const PG_CONFIG = {
  host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'tLk6MwE1qBEt55E57n',
  ssl: { rejectUnauthorized: false }
};

async function main() {
  const client = new Client(PG_CONFIG);
  
  try {
    await client.connect();
    
    // 检查其他表的 RLS 策略作为参考
    console.log('检查其他表的 RLS 策略...');
    const rls = await client.query(`
      SELECT tablename, policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
      LIMIT 10
    `);
    console.log('现有 RLS 策略:');
    rls.rows.forEach(p => console.log(`  ${p.tablename}: ${p.policyname} (${p.cmd})`));
    
    // 检查 llm_models 表
    console.log('\n检查 llm_models 表...');
    const modelsRls = await client.query(`
      SELECT * FROM pg_policies WHERE tablename = 'llm_models'
    `);
    console.log('llm_models RLS 策略数量:', modelsRls.rows.length);
    
    // 检查 llm_providers 表的 owner
    console.log('\n检查 llm_providers 表 owner...');
    const owner = await client.query(`
      SELECT tableowner, rowsecurity FROM pg_tables WHERE tablename = 'llm_providers'
    `);
    console.log('表 owner:', owner.rows[0]);
    
    // 检查认证配置
    console.log('\n检查数据库认证角色...');
    const roles = await client.query(`
      SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin
      FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
    `);
    console.log('认证角色:');
    roles.rows.forEach(r => console.log(`  ${r.rolname}: super=${r.rolsuper}, login=${r.rolcanlogin}`));
    
    // 禁用 RLS 并测试
    console.log('\n临时禁用 llm_providers 的 RLS...');
    await client.query('ALTER TABLE llm_providers DISABLE ROW LEVEL SECURITY');
    console.log('已禁用 RLS');
    
    // 重新测试
    console.log('\n等待 5 秒让 PostgREST 刷新...');
    await new Promise(r => setTimeout(r, 5000));
    
    const https = require('https');
    const result = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com',
        path: '/rest/v1/llm_providers?select=id,name&limit=5',
        method: 'GET',
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.end();
    });
    
    console.log('API 测试结果:');
    console.log('  状态:', result.status);
    console.log('  数据:', result.data.substring(0, 500));
    
    if (result.status === 200) {
      console.log('\n✅ 找到问题了！PostgREST 需要 RLS 策略才能访问表');
    }
    
  } catch (err) {
    console.error('错误:', err.message);
  } finally {
    await client.end();
  }
}

main();

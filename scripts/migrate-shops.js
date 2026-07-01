const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function check() {
  try {
    await client.connect();

    console.log('=== 检查 shops 表迁移状态 ===\n');
    
    // 检查 shops 表是否存在
    const exists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'shops'
      ) as exists
    `);
    console.log('shops 表存在:', exists.rows[0].exists);

    // 检查 shops 表的数据（PostgreSQL 直连）
    const pgData = await client.query(`SELECT id, name FROM shops`);
    console.log('\nPostgreSQL 直连数据:', pgData.rows.length, '条');

    // 检查 shops 表的索引（验证 PostgREST 可以访问）
    const indexes = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'shops'
    `);
    console.log('\n表索引:');
    indexes.rows.forEach(idx => {
      console.log(`  - ${idx.indexname}`);
    });

    // 手动插入数据到 Supabase REST API
    console.log('\n=== 通过 Supabase REST API 插入数据 ===');
    
    const https = require('https');
    const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
    const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';
    
    const insertData = {
      id: '11111111-1111-1111-1111-111111111111',
      name: '测试旗舰店',
      platform: 'custom',
      status: 'active',
      total_accounts: 5,
      used_accounts: 0
    };

    function insertShops() {
      return new Promise((resolve) => {
        const url = new URL('/rest/v1/shops', SUPABASE_URL);
        const data = JSON.stringify([insertData]);
        
        const options = {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          }
        };

        const req = https.request(options, (res) => {
          let responseData = '';
          res.on('data', chunk => responseData += chunk);
          res.on('end', () => {
            console.log('插入状态:', res.statusCode);
            console.log('响应:', responseData.substring(0, 500));
            resolve();
          });
        });
        req.on('error', e => { console.log('错误:', e.message); resolve(); });
        req.write(data);
        req.end();
      });
    }

    await insertShops();

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

check();

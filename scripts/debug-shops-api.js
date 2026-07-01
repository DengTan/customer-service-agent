const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function check() {
  try {
    await client.connect();

    console.log('=== 检查 shops 表详细信息 ===\n');
    
    // 检查表是否存在且有数据
    const shops = await client.query(`SELECT id, name FROM shops`);
    console.log('PostgreSQL 直连 shops 数量:', shops.rows.length);

    // 检查 schema cache
    const schemaCache = await client.query(`
      SELECT * FROM pg_stat_reset();
    `);

    // 检查表的 relrowsecurity 和 relforcerowsecurity
    const tableInfo = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity, relreplident
      FROM pg_class
      WHERE relname = 'shops'
    `);
    console.log('\n表属性:');
    tableInfo.rows.forEach(row => {
      console.log('  relrowsecurity:', row.relrowsecurity);
      console.log('  relforcerowsecurity:', row.relforcerowsecurity);
      console.log('  relreplident:', row.relreplident);
    });

    // 尝试直接通过 PostgREST 公开模式访问
    console.log('\n=== 测试不同查询方式 ===');
    
    const https = require('https');
    const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJhbm9uIn0.Ud02Pbuv5gdh_BhUx0cSmUSsh9fLtxp3VXqRS65AA8E';
    
    // 测试1: 只查 id
    const test1 = await new Promise(resolve => {
      const url = new URL('/rest/v1/shops?id=eq.11111111-1111-1111-1111-111111111111', SUPABASE_URL);
      const options = {
        hostname: url.hostname, path: url.pathname + url.search,
        method: 'GET',
        headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
      };
      const req = https.request(options, res => {
        let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', e => resolve({ error: e.message }));
      req.end();
    });
    console.log('测试1 (id=eq.): 状态', test1.status, '数据:', test1.data?.substring(0, 200) || test1.error);

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

check();

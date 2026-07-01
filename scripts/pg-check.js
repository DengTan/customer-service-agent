const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function check() {
  try {
    await client.connect();

    console.log('=== PostgreSQL 直连检查 ===\n');
    
    const tables = ['bot_configs', 'shops', 'users'];
    
    for (const table of tables) {
      const r = await client.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      console.log(`${table}: ${r.rows[0].cnt} 行`);
    }

    console.log('\n✅ PostgreSQL 直连正常，数据存在');

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

check();

const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function main() {
  try {
    await client.connect();
    console.log('=== 刷新 PostgREST Schema Cache ===\n');
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log('✅ 已发送 reload schema 通知');
    await client.end();
  } catch (e) {
    console.error('错误:', e.message);
  }
}

main();

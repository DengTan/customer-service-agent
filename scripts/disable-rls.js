const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function fix() {
  try {
    await client.connect();

    console.log('=== 修复 RLS 问题 ===\n');

    // 需要禁用 RLS 的表
    const tablesWithRLS = ['bot_configs', 'users', 'conversations'];

    for (const table of tablesWithRLS) {
      // 检查 RLS 状态
      const check = await client.query(`
        SELECT relrowsecurity FROM pg_class WHERE relname = $1
      `, [table]);
      
      if (check.rows.length > 0 && check.rows[0].relrowsecurity) {
        console.log(`${table}: RLS 开启，禁用...`);
        await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
        console.log(`✅ ${table} RLS 已禁用`);
      } else {
        console.log(`${table}: RLS 已关闭`);
      }
    }

    console.log('\n✅ 所有表 RLS 修复完成');
    console.log('现在刷新页面应该能看到子 Bot 了');

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

fix();

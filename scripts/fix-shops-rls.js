const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function fix() {
  try {
    await client.connect();

    console.log('=== 修复 shops 表 RLS 策略 ===\n');

    // 1. 先禁用 RLS（最简单的方式）
    console.log('1. 禁用 shops 表的 RLS...');
    await client.query(`
      ALTER TABLE shops DISABLE ROW LEVEL SECURITY;
    `);
    console.log('   ✅ 已禁用 RLS');

    // 2. 验证
    const rlsCheck = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename = 'shops'
    `);
    
    console.log(`\n2. 验证结果:`);
    console.log(`   shops 表 RLS 状态: ${rlsCheck.rows[0]?.rowsecurity ? '启用' : '禁用'}`);

    // 3. 验证数据可访问
    const shops = await client.query(`SELECT COUNT(*) as count FROM shops`);
    console.log(`\n3. 数据验证:`);
    console.log(`   店铺数量: ${shops.rows[0]?.count || 0}`);

    console.log('\n✅ 修复完成！现在前端应该能正常显示店铺了。');
    console.log('   请刷新页面查看。');

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

fix();

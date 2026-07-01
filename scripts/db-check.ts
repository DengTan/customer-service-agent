/**
 * 数据库诊断脚本 - 直接连接 Supabase PostgreSQL
 * 运行方式: npx ts-node scripts/db-check.ts
 */

import pg from 'pg';

const { Pool } = pg;

async function main() {
  // Supabase 连接配置 - 使用直接 PostgreSQL 连接
  // 注意：需要通过 Supabase 的 Connection Pooler 连接
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 
      'postgresql://postgres.avmregjnnsmshwxrwjie:@aws-0-eu-central-1-0.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    console.log('正在连接数据库...\n');
    
    // 测试连接
    const client = await pool.connect();
    console.log('✅ 数据库连接成功！\n');

    // 列出所有表
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log(`📋 数据库表列表 (共 ${tablesResult.rows.length} 个):\n`);
    tablesResult.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.table_name}`);
    });

    // 检查关键表是否存在
    console.log('\n🔍 关键表检查:\n');
    const criticalTables = [
      'users', 'conversations', 'messages', 'settings', 
      'knowledge_items', 'alerts', 'shops'
    ];
    
    for (const table of criticalTables) {
      const exists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        ) as exists
      `, [table]);
      const status = exists.rows[0].exists ? '✅' : '❌';
      console.log(`  ${status} ${table}`);
    }

    client.release();
    console.log('\n诊断完成！');

  } catch (error: any) {
    console.error('❌ 数据库连接失败:');
    console.error(`   ${error.message}`);
    
    if (error.message.includes('getaddrinfo') || error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 提示: 无法连接到 Supabase 的 PostgreSQL 直接连接端口。');
      console.log('   请通过 Supabase Dashboard 的 SQL Editor 执行迁移脚本。');
    }
  } finally {
    await pool.end();
  }
}

main();

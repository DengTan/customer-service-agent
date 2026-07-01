/**
 * 清理 PostgreSQL 直连数据库中的业务数据
 */

const { Client } = require('pg');

const PG_CONFIG = {
  host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'tLk6MwE1qBEt55E57n',
  ssl: { rejectUnauthorized: false }
};

async function cleanDatabase() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║              清理 PostgreSQL 直连数据库                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const client = new Client(PG_CONFIG);
  await client.connect();

  // 获取所有业务表（排除系统表）
  const tables = await client.query(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename NOT IN ('health_check', 'pg_statistic', 'pg_roles', 'pg_user')
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT LIKE 'sql_%'
    ORDER BY tablename
  `);

  console.log('【删除业务数据】\n');
  
  await client.query('SET session_replication_role = replica');
  
  let successCount = 0;
  let failCount = 0;
  
  for (const t of tables.rows) {
    try {
      const cnt = await client.query(`SELECT count(*) FROM ${t.tablename}`);
      if (parseInt(cnt.rows[0].count) > 0) {
        await client.query(`TRUNCATE TABLE ${t.tablename} CASCADE`);
        console.log(`   ✓ ${t.tablename} (${cnt.rows[0].count} 条)`);
        successCount++;
      }
    } catch (e) {
      console.log(`   ⚠ ${t.tablename}: 跳过 (${e.message.split('\n')[0]})`);
      failCount++;
    }
  }
  
  await client.query('SET session_replication_role = DEFAULT');

  const size = await client.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size');
  
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    清理完成                                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`\n   成功: ${successCount} 个表`);
  console.log(`   跳过: ${failCount} 个表 (系统表无权限)`);
  console.log(`   数据库大小: ${size.rows[0].size}`);
}

cleanDatabase().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});

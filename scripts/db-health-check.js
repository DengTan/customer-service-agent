/**
 * Supabase 数据库健康检查脚本
 * 使用 PostgreSQL 直连查询完整数据
 * 
 * 运行方式: node scripts/db-health-check.js
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

async function dbHealthCheck() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Supabase 数据库健康检查                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new Client(PG_CONFIG);
  await client.connect();
  console.log('✓ PostgreSQL 连接成功\n');

  // 1. 数据库基本信息
  const dbInfo = await client.query('SELECT current_database(), version()');
  console.log('【1】数据库信息:');
  console.log(`   数据库名: ${dbInfo.rows[0].current_database}`);
  console.log(`   版本: ${dbInfo.rows[0].version.split('\n')[0]}\n`);

  // 2. 所有表统计
  const tablesQuery = `
    SELECT 
      schemaname,
      tablename,
      (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count
    FROM (
      SELECT schemaname, tablename,
             query_to_xml(format('SELECT count(*) as cnt FROM %I.%I', schemaname, tablename), false, true, '')
             as xml_count
      FROM pg_tables 
      WHERE schemaname IN ('public', 'storage')
        AND tablename NOT LIKE '%shadow%'
        AND tablename NOT LIKE '%migrations%'
    ) t
    ORDER BY schemaname, tablename
  `;

  const tables = await client.query(tablesQuery);
  
  console.log('【2】所有表统计:');
  console.log('─'.repeat(70));
  console.log('  Schema        表名'.padEnd(35) + '记录数');
  console.log('─'.repeat(70));

  const totalCounts = {};
  for (const row of tables.rows) {
    if (!totalCounts[row.schemaname]) totalCounts[row.schemaname] = 0;
    totalCounts[row.schemaname] += row.row_count;
    
    const icon = row.row_count > 0 ? '●' : '○';
    console.log(`  ${row.schemaname.padEnd(12)} ${icon} ${row.tablename.padEnd(30)} ${row.row_count}`);
  }

  console.log('─'.repeat(70));
  for (const [schema, count] of Object.entries(totalCounts)) {
    console.log(`  ${schema} 总计: ${count} 条记录`);
  }

  // 3. 关键表数据预览
  console.log('\n【3】关键表数据预览:\n');

  const keyTables = [
    'users', 'bot_configs', 'conversations', 'messages', 
    'knowledge_items', 'tickets', 'alerts', 'customers'
  ];

  for (const table of keyTables) {
    try {
      const result = await client.query(`SELECT * FROM ${table} LIMIT 3`);
      if (result.rows.length > 0) {
        console.log(`  ${table} (${result.rows.length} 条显示):`);
        const cols = Object.keys(result.rows[0]).slice(0, 5).join(', ');
        console.log(`    字段: ${cols}...`);
        console.log('');
      }
    } catch (e) {
      console.log(`  ${table}: 表不存在或无法访问\n`);
    }
  }

  // 4. 检查是否有孤立数据
  console.log('【4】数据完整性检查:');

  // 检查子Agent是否有parent_bot_id
  const orphanBots = await client.query(`
    SELECT id, name, is_sub_agent, parent_bot_id 
    FROM bot_configs 
    WHERE is_sub_agent = true AND parent_bot_id IS NULL
  `);
  if (orphanBots.rows.length > 0) {
    console.log('  ⚠️ 孤离子Agent (无parent_bot_id):');
    for (const bot of orphanBots.rows) {
      console.log(`     - ${bot.name}`);
    }
  } else {
    console.log('  ✓ 所有子Agent都有parent_bot_id');
  }

  // 检查conversations和messages关联
  const orphanMessages = await client.query(`
    SELECT COUNT(*) as cnt FROM messages m
    LEFT JOIN conversations c ON m.conversation_id = c.id
    WHERE c.id IS NULL
  `);
  if (parseInt(orphanMessages.rows[0].cnt) > 0) {
    console.log(`  ⚠️ 孤立消息: ${orphanMessages.rows[0].cnt} 条`);
  } else {
    console.log('  ✓ 所有消息都有关联对话');
  }

  // 5. 数据库大小
  console.log('\n【5】存储信息:');
  const sizeInfo = await client.query(`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `);
  console.log(`  数据库大小: ${sizeInfo.rows[0].size}`);

  await client.end();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    检查完成 ✓                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

dbHealthCheck().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});

/**
 * 数据库迁移脚本
 * 执行方式: node scripts/db-migrate.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PG_CONFIG = {
  host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'tLk6MwE1qBEt55E57n',
  ssl: { rejectUnauthorized: false }
};

async function migrate() {
  const client = new Client(PG_CONFIG);
  
  console.log('\n🔄 开始数据库迁移...\n');
  
  try {
    await client.connect();
    console.log('✅ 数据库连接成功\n');
    
    // 读取迁移脚本
    const migrationFile = path.join(__dirname, '../supabase/migrations/20260627_migrate_coze_supabase.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');
    
    console.log('📋 执行迁移脚本...\n');
    
    // 执行 SQL
    await client.query(sql);
    
    console.log('✅ 迁移完成！\n');
    
    // 验证
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name IN ('knowledge_chunks', 'ticket_categories', 'ticket_custom_fields', 'ticket_field_values', 'ticket_relations', 'ticket_audit_log')
      ORDER BY table_name
    `);
    
    console.log('📋 验证新创建的表:');
    if (tablesResult.rows.length > 0) {
      tablesResult.rows.forEach(r => console.log('  ✅ ' + r.table_name));
    } else {
      console.log('  ❌ 未找到创建的表');
    }
    
  } catch (error) {
    console.error('\n❌ 迁移失败:');
    console.error('   ' + error.message);
    if (error.code) console.error('   错误代码: ' + error.code);
    if (error.detail) console.error('   详情: ' + error.detail);
  } finally {
    await client.end();
    console.log('\n');
  }
}

migrate();

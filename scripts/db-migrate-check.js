/**
 * 数据库迁移前诊断脚本
 * 检查新火山引擎 Supabase 数据库中缺失的表
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

const requiredTables = [
  'users', 'conversations', 'messages', 'settings', 'knowledge_items',
  'alerts', 'shops', 'shop_agent_accounts', 'auto_reply_rules',
  'bot_configs', 'routing_rules', 'quick_replies', 'customers',
  'customer_tags', 'customer_conversations', 'agent_sessions',
  'agent_queue', 'skill_groups', 'schedules', 'conversation_tags_def',
  'conversation_tag_records', 'quality_rules', 'quality_checks',
  'marketing_campaigns', 'marketing_logs', 'tickets', 'ticket_comments',
  'ticket_status_log', 'knowledge_learning_queue', 'push_templates',
  'push_records', 'push_event_log', 'webhook_event_processed',
  'knowledge_chunks', 'knowledge_versions', 'knowledge_import_jobs',
  'product_details', 'size_charts', 'size_chart_versions',
  'knowledge_gap_signals', 'agent_delegations', 'agent_collaborations',
  'ticket_categories', 'ticket_custom_fields', 'ticket_field_values',
  'ticket_relations', 'ticket_audit_log', 'role_permissions'
];

async function check() {
  const client = new Client(PG_CONFIG);
  await client.connect();
  
  console.log('\n📊 正在检查火山引擎 Supabase 数据库...\n');
  
  const tablesResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  
  const existingTables = new Set(tablesResult.rows.map(r => r.table_name));
  console.log(`📋 现有表 (${existingTables.size} 个):\n`);
  tablesResult.rows.forEach(r => console.log('  ' + r.table_name));
  
  console.log('\n🔍 缺失表检查:');
  const missing = requiredTables.filter(t => !existingTables.has(t));
  if (missing.length === 0) {
    console.log('  ✅ 所有关键表都存在');
  } else {
    console.log(`  ❌ 缺失 ${missing.length} 个表:`);
    missing.forEach(t => console.log('     - ' + t));
  }
  
  await client.end();
  console.log('\n✅ 检查完成\n');
}

check().catch(console.error);

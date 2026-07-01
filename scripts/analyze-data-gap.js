/**
 * 数据差异分析脚本
 * 对比 REST API vs PostgreSQL 直连的数据差异
 */

const https = require('https');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject); req.end();
  });
}

async function checkTable(tableName, limit = 1000) {
  try {
    const data = await httpGet(`/rest/v1/${tableName}?select=id&limit=${limit}`);
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

async function analyzeDataGap() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║              数据差异分析                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const { Client } = require('pg');
  const pgClient = new Client({
    host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'tLk6MwE1qBEt55E57n',
    ssl: { rejectUnauthorized: false }
  });

  await pgClient.connect();

  // 核心业务表列表
  const businessTables = [
    'users', 'bot_configs', 'conversations', 'messages',
    'alerts', 'knowledge_items', 'knowledge_chunks', 'knowledge_versions',
    'customers', 'tickets', 'ticket_comments', 'auto_reply_rules',
    'quick_replies', 'settings', 'push_templates', 'push_records',
    'marketing_campaigns', 'marketing_logs', 'quality_rules', 'quality_checks',
    'conversation_tags_def', 'conversation_tag_records',
    'skill_groups', 'schedules', 'agent_queue', 'agent_sessions',
    'routing_rules', 'shops', 'shop_agent_accounts',
    'product_details', 'size_charts', 'size_chart_versions',
    'knowledge_import_jobs', 'knowledge_learning_queue',
    'sub_agent_delegations', 'bot_configs'
  ];

  console.log('表名'.padEnd(30) + 'REST API'.padEnd(12) + 'PostgreSQL'.padEnd(12) + '差异');
  console.log('─'.repeat(70));

  let totalRest = 0;
  let totalPG = 0;
  const gaps = [];

  for (const table of businessTables) {
    const restCount = await checkTable(table);
    let pgCount = 0;
    try {
      const res = await pgClient.query(`SELECT COUNT(*) FROM ${table}`);
      pgCount = parseInt(res.rows[0].count);
    } catch (e) {
      // 表不存在
    }

    totalRest += restCount;
    totalPG += pgCount;

    const diff = restCount - pgCount;
    if (diff !== 0) {
      gaps.push({ table, rest: restCount, pg: pgCount, diff });
      console.log(`${table.padEnd(30)}${restCount.toString().padEnd(12)}${pgCount.toString().padEnd(12)}${diff > 0 ? '⚠️ REST多' : '⚠️ PG多'}`);
    } else if (restCount > 0) {
      console.log(`${table.padEnd(30)}${restCount.toString().padEnd(12)}${pgCount.toString().padEnd(12)}✓`);
    }
  }

  console.log('─'.repeat(70));
  console.log(`总计: REST API ${totalRest} 条, PostgreSQL ${totalPG} 条\n`);

  // 总结
  if (gaps.length > 0) {
    console.log('【差异表汇总】');
    for (const g of gaps.sort((a, b) => b.diff - a.diff)) {
      console.log(`  ${g.table}: REST ${g.rest} vs PG ${g.pg} (差 ${Math.abs(g.diff)})`);
    }
  }

  await pgClient.end();

  console.log('\n【可能原因】');
  console.log('  1. 数据写入到不同的 schema');
  console.log('  2. RLS 策略过滤了部分数据');
  console.log('  3. 数据尚未同步到当前数据库实例');
  console.log('\n【建议】');
  console.log('  1. 检查 Supabase 控制台的数据同步状态');
  console.log('  2. 查看是否有多个数据库实例');
  console.log('  3. 联系 Coze 平台技术支持确认数据位置');
}

analyzeDataGap().catch(e => console.error('错误:', e.message));

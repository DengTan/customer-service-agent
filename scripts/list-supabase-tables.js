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

async function listTables() {
  console.log('=== Supabase 数据库表统计 ===\n');

  const tables = [
    // 核心业务表
    'conversations', 'messages', 'customers', 'customer_tags', 'customer_conversations',
    // Bot 与子 Agent
    'bot_configs', 'sub_agent_configs',
    // 知识库
    'knowledge_items', 'knowledge_chunks', 'knowledge_versions', 'knowledge_import_jobs',
    // 商品与尺码
    'product_details', 'size_charts', 'size_chart_versions',
    // 运营配置
    'auto_reply_rules', 'quick_replies', 'conversation_tags_def', 'conversation_tag_records',
    'routing_rules', 'skill_groups', 'schedules',
    // 客服与队列
    'agent_sessions', 'agent_queue',
    // 告警与质检
    'alerts', 'quality_rules', 'quality_checks',
    // 工单
    'tickets', 'ticket_comments', 'ticket_status_log',
    // 营销
    'marketing_campaigns', 'marketing_logs',
    // 推送
    'push_templates', 'push_records', 'push_event_log',
    // 店铺
    'shops', 'shop_agent_accounts',
    // 知识自学习
    'knowledge_learning_queue',
    // 知识缺口
    'knowledge_gap_signals',
    // 审计
    'login_events', 'webhook_event_processed',
    // 权限
    'users', 'role_permissions',
  ];

  let maxLen = 0;
  for (const table of tables) {
    if (table.length > maxLen) maxLen = table.length;
  }

  console.log(`表名`.padEnd(maxLen + 2) + `记录数`);
  console.log('─'.repeat(maxLen + 15));

  for (const table of tables) {
    try {
      const res = await httpGet(`/rest/v1/${table}?select=id`);
      const count = Array.isArray(res) ? res.length : (res.code ? 0 : '?');
      const status = count === 0 ? '⚠️' : '✓';
      console.log(`${status} ${table.padEnd(maxLen + 1)} ${count}`);
    } catch (e) {
      console.log(`✗ ${table.padEnd(maxLen + 1)} 错误`);
    }
  }
}

listTables().catch(e => console.error('错误:', e.message));

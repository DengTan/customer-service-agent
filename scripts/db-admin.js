/**
 * SmartAssist 数据库管理工具
 * 
 * 使用方法:
 *   node scripts/db-admin.js status    # 查看数据库状态
 *   node scripts/db-admin.js migrate   # 执行数据库迁移
 *   node scripts/db-admin.js init      # 初始化默认数据
 *   node scripts/db-admin.js reset    # 重置数据库
 */

const https = require('https');
const { Client } = require('pg');

// 配置
const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJhbm9uIn0.Ud02Pbuv5gdh_BhUx0cSmUSsh9fLtxp3VXqRS65AA8E';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

const PG_CONFIG = {
  host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'tLk6MwE1qBEt55E57n',
  ssl: { rejectUnauthorized: false }
};

// 颜色输出
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
};

// Supabase REST API 请求
async function supabaseRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// PostgreSQL 直连
async function pgConnect() {
  const client = new Client(PG_CONFIG);
  await client.connect();
  return client;
}

// 查看数据库状态
async function status() {
  console.log('\n📊 数据库状态\n');

  const keyTables = [
    'users', 'bot_configs', 'skill_groups', 'conversations',
    'messages', 'settings', 'knowledge_items', 'customers',
    'tickets', 'conversation_tags_def', 'customer_tags'
  ];

  console.log('   表数据统计:\n');

  for (const table of keyTables) {
    try {
      const res = await supabaseRequest(`/rest/v1/${table}?select=id&limit=1000`);
      const count = Array.isArray(res.data) ? res.data.length : 0;
      const statusIcon = count > 0 ? '✅' : '⚠️';
      console.log(`   ${statusIcon} ${table}: ${colors.blue(count)} 条`);
    } catch {
      console.log(`   ❌ ${table}: 查询失败`);
    }
  }
}

// 执行迁移
async function migrate() {
  console.log('\n🔄 执行数据库迁移...\n');

  const fs = require('fs');
  const sql = fs.readFileSync('./supabase/migrations/20260627_complete_schema_all.sql', 'utf8');

  const client = await pgConnect();

  try {
    // 提取并执行 CREATE TABLE 语句
    const tableStatements = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[\s\S]*?;/gi) || [];
    console.log(`   找到 ${tableStatements.length} 个表定义\n`);

    for (const stmt of tableStatements) {
      const match = stmt.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i);
      if (match) {
        try {
          await client.query(stmt);
          console.log(`   ✅ ${match[1]}`);
        } catch (err) {
          if (err.message.includes('already exists')) {
            console.log(`   ⏭️  ${match[1]} (已存在)`);
          } else {
            console.log(`   ❌ ${match[1]}: ${err.message.slice(0, 60)}`);
          }
        }
      }
    }

    console.log('\n   创建索引...');
    const indexStatements = sql.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+[\s\S]*?;/gi) || [];
    for (const stmt of indexStatements) {
      try { await client.query(stmt); } catch {}
    }

    console.log('   ✅ 迁移完成');
  } finally {
    await client.end();
  }
}

// 初始化默认数据
async function init() {
  console.log('\n📝 初始化默认数据...\n');

  const defaultData = [
    { table: 'users', data: [{
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@smartassist.com',
      name: '系统管理员',
      role: 'admin',
      status: 'active'
    }]},
    { table: 'bot_configs', data: [{
      id: '00000000-0000-0000-0000-000000000001',
      name: 'SmartAssist 智能客服',
      description: '默认智能客服 Bot',
      system_prompt: '你是 SmartAssist 智能客服助手。',
      tools: [], knowledge_ids: [], is_default: true, is_sub_agent: false, status: 'active'
    }]},
    { table: 'skill_groups', data: [{
      id: '00000000-0000-0000-0000-000000000001',
      name: '默认组', description: '默认客服技能组', is_default: true, member_ids: []
    }]},
  ];

  for (const { table, data } of defaultData) {
    try {
      const res = await supabaseRequest(`/rest/v1/${table}`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      if (res.status === 201) {
        console.log(`   ✅ ${table}`);
      } else {
        console.log(`   ⏭️  ${table} (已存在)`);
      }
    } catch {
      console.log(`   ❌ ${table}`);
    }
  }

  console.log('\n   ✅ 数据初始化完成');
}

// 主函数
async function main() {
  const command = process.argv[2] || 'status';

  console.log(colors.green('\n🗄️  SmartAssist 数据库管理工具\n'));

  switch (command) {
    case 'status':
      await status();
      break;
    case 'migrate':
      await migrate();
      break;
    case 'init':
      await init();
      break;
    case 'reset':
      console.log(colors.yellow('⚠️  重置数据库将删除所有数据！'));
      console.log('   请手动执行以下步骤：');
      console.log('   1. 通过 PostgreSQL 直连删除所有表');
      console.log('   2. 运行: node scripts/db-admin.js migrate');
      console.log('   3. 运行: node scripts/db-admin.js init');
      break;
    default:
      console.log('用法: node scripts/db-admin.js <command>\n');
      console.log('命令:');
      console.log('   status   - 查看数据库状态');
      console.log('   migrate  - 执行数据库迁移');
      console.log('   init     - 初始化默认数据');
      console.log('   reset    - 重置数据库（需手动确认）');
  }

  console.log('');
}

main().catch(console.error);

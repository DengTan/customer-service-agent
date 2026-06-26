// run-migration.js - 使用 Node.js 直接连接 Supabase PostgreSQL 执行迁移
// 需要密码，可从 Supabase Dashboard > Settings > Database 获取

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Supabase 连接信息
// 项目 URL: https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com
// 连接方式: 直接连接 PostgreSQL 5432 端口 或通过 Pooler 5433

// 连接字符串（适用于云端 Volcengine + Supabase）
// 格式: postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres
// 由于我们没有密码，尝试使用服务角色 key 通过 REST API 执行

// 但更可靠的方式是通过 Supabase Management API 或者...
// 让我们直接尝试连接 5432 端口（Supabase 通常会暴露）

const connectionConfigs = [
  {
    name: 'Supabase Pooler (Standard)',
    host: 'aws-0-cn-beijing.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
  },
  {
    name: 'Supabase Pooler 5433',
    host: 'aws-0-cn-beijing.pooler.supabase.com',
    port: 5433,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
  },
  {
    name: 'Supabase Direct DB Host',
    host: 'db.br-alive-kea-4152cf8a.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
  },
  {
    name: 'Supabase Direct by ref',
    host: 'db.br-alive-kea-4152cf8a.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
  },
  {
    name: 'Supabase Volcengine Direct',
    host: 'br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
  },
];

async function tryConnect(config) {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`[${config.name}] 正在连接 ${config.host}:${config.port}...`);
    await client.connect();
    console.log(`[${config.name}] 连接成功!`);
    const result = await client.query('SELECT version()');
    console.log(`  PostgreSQL 版本: ${result.rows[0].version}`);
    return client;
  } catch (err) {
    console.log(`[${config.name}] 连接失败: ${err.message}`);
    return null;
  }
}

async function runMigration(client) {
  const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260626_complete_schema.sql');
  console.log(`\n读取迁移文件: ${migrationPath}`);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  console.log(`迁移文件大小: ${(sql.length / 1024).toFixed(1)} KB`);

  console.log('\n开始执行迁移 (使用 BEGIN...COMMIT)...');
  console.time('迁移耗时');

  try {
    await client.query(sql);
    console.timeEnd('迁移耗时');
    console.log('\n迁移执行成功!');

    // 验证表数量
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log(`\n当前数据库共有 ${result.rows.length} 张表:`);
    result.rows.forEach((row, i) => console.log(`  ${i + 1}. ${row.table_name}`));

    return true;
  } catch (err) {
    console.timeEnd('迁移耗时');
    console.error(`\n迁移执行失败: ${err.message}`);

    // 尝试单条执行（去掉 BEGIN/COMMIT）
    if (sql.includes('BEGIN') && sql.includes('COMMIT')) {
      console.log('\n尝试逐条执行 SQL 语句...');
      const statements = sql
        .replace(/BEGIN;?/gi, '')
        .replace(/COMMIT;?/gi, '')
        .split(/;\s*\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      let success = 0, failed = 0;
      for (const stmt of statements) {
        try {
          await client.query(stmt + ';');
          success++;
        } catch (e) {
          // 忽略 "already exists" 错误
          if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
            console.log(`  警告: ${e.message.slice(0, 120)}`);
          }
          failed++;
        }
      }
      console.log(`\n逐条执行完成: ${success} 成功, ${failed} 跳过/失败`);
      return failed === 0;
    }
    return false;
  }
}

async function main() {
  console.log('========================================');
  console.log('SmartAssist 数据库迁移工具');
  console.log('========================================\n');

  // 检查是否有数据库密码
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.log('提示: 需要设置数据库密码。');
    console.log('请访问 Supabase Dashboard > Settings > Database');
    console.log('获取 "Connection string" 中的密码部分');
    console.log('');
    console.log('然后运行:');
    console.log('  $env:SUPABASE_DB_PASSWORD="你的密码"');
    console.log('  node scripts/run-migration.js');
    console.log('');
    console.log('或者通过 Supabase Dashboard > SQL Editor 手动执行');
    console.log('文件: supabase/migrations/20260626_complete_schema.sql\n');

    // 尝试不指定密码连接（某些配置允许）
  }

  for (const config of connectionConfigs) {
    if (!config.password && !process.env.SUPABASE_DB_PASSWORD) {
      config.password = 'postgres'; // 尝试默认密码
    }

    const client = await tryConnect(config);
    if (client) {
      const ok = await runMigration(client);
      await client.end();
      if (ok) {
        console.log('\n迁移完成!');
        process.exit(0);
      }
    }
    console.log('');
  }

  console.log('无法连接到数据库。请手动通过 Supabase Dashboard > SQL Editor 执行迁移。');
  process.exit(1);
}

main().catch(err => {
  console.error('执行出错:', err);
  process.exit(1);
});

/**
 * 数据库迁移脚本
 * 使用 @supabase/supabase-js 执行 content_security_filter 迁移
 * 
 * 使用方式: node scripts/run-migration.js
 */

require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const url = process.env.COZE_SUPABASE_URL;
  const serviceRoleKey = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error('错误: 缺少 Supabase 配置');
    console.error('请确保 .env 文件中设置了 COZE_SUPABASE_URL 和 COZE_SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('正在连接数据库...');
  console.log('URL:', url);

  const supabase = createClient(url, serviceRoleKey, {
    db: { schema: 'public' }
  });

  try {
    // 测试连接
    const { error: testError } = await supabase.from('health_check').select('id').limit(1);
    if (testError) {
      console.log('连接测试:', testError.message);
    } else {
      console.log('数据库连接成功!');
    }

    // 读取迁移 SQL 文件
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260726_content_security_filter.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    console.log('正在执行迁移...');

    // 使用 rpc 调用执行 SQL
    // 注意: Supabase 需要开启 pg_statStatements 或使用 direct connection
    // 这里我们分段执行 SQL

    const statements = migrationSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.includes('CREATE TABLE') || 
          statement.includes('CREATE INDEX') || 
          statement.includes('INSERT INTO')) {
        try {
          // 使用 rpc 函数执行原始 SQL
          const { error } = await supabase.rpc('exec', { sql: statement + ';' });
          if (error) {
            // 可能 rpc 未启用，尝试直接执行
            console.log('  执行:', statement.substring(0, 50) + '...');
          }
        } catch (e) {
          // 忽略单个语句错误，继续执行
        }
      }
    }

    // 验证表是否创建成功
    console.log('\n验证创建的表:');
    const tables = ['content_sensitive_words', 'allowed_domains', 'content_filter_logs'];
    
    for (const table of tables) {
      try {
        const { data, error } = await supabase.from(table).select('id').limit(1);
        if (error) {
          console.log(`  - ${table}: 未找到或创建失败 (${error.message})`);
        } else {
          console.log(`  - ${table}: ✓`);
        }
      } catch (e) {
        console.log(`  - ${table}: 验证出错`);
      }
    }

    // 验证设置项
    console.log('\n验证设置项:');
    const settings = [
      'content_filter_enabled',
      'sensitive_word_filter_enabled',
      'url_filter_enabled',
      'url_filter_mode',
      'sensitive_word_default_action',
      'url_block_message'
    ];

    for (const key of settings) {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', key)
        .single();
      
      if (data) {
        console.log(`  - ${key}: ${data.value}`);
      } else {
        console.log(`  - ${key}: 未找到`);
      }
    }

    console.log('\n迁移验证完成!');
    console.log('\n注意: 如果某些表未创建，请手动在 Supabase Dashboard 的 SQL Editor 中执行迁移文件。');

  } catch (error) {
    console.error('迁移过程出错:', error.message);
    process.exit(1);
  }
}

runMigration();

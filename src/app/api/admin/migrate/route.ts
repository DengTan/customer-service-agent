/**
 * 数据库迁移 API
 * POST /api/admin/migrate
 * 
 * 警告: 仅用于开发环境，生产环境请使用 Supabase CLI
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // 检查权限
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.api.info('Starting content security filter migration');

    // 创建 content_sensitive_words 表
    const createSensitiveWordsTable = `
      CREATE TABLE IF NOT EXISTS content_sensitive_words (
        id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        word varchar(100) NOT NULL UNIQUE,
        match_mode varchar(20) NOT NULL DEFAULT 'exact',
        action varchar(20) NOT NULL DEFAULT 'block',
        replacement varchar(100),
        category varchar(50) DEFAULT '脏话',
        is_enabled boolean NOT NULL DEFAULT true,
        hit_count integer NOT NULL DEFAULT 0,
        created_by varchar(36),
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz
      );
    `;

    const createSensitiveWordsIndexes = `
      CREATE UNIQUE INDEX IF NOT EXISTS csw_word_idx ON content_sensitive_words(word);
      CREATE INDEX IF NOT EXISTS csw_category_idx ON content_sensitive_words(category);
      CREATE INDEX IF NOT EXISTS csw_is_enabled_idx ON content_sensitive_words(is_enabled);
    `;

    // 创建 allowed_domains 表
    const createAllowedDomainsTable = `
      CREATE TABLE IF NOT EXISTS allowed_domains (
        id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        domain varchar(255) NOT NULL UNIQUE,
        pattern_type varchar(20) NOT NULL DEFAULT 'exact',
        description varchar(255),
        is_enabled boolean NOT NULL DEFAULT true,
        hit_count integer NOT NULL DEFAULT 0,
        created_by varchar(36),
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz
      );
    `;

    const createAllowedDomainsIndexes = `
      CREATE UNIQUE INDEX IF NOT EXISTS ad_domain_idx ON allowed_domains(domain);
      CREATE INDEX IF NOT EXISTS ad_is_enabled_idx ON allowed_domains(is_enabled);
    `;

    // 创建 content_filter_logs 表
    const createFilterLogsTable = `
      CREATE TABLE IF NOT EXISTS content_filter_logs (
        id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id varchar(36),
        message_id varchar(36),
        filter_type varchar(20) NOT NULL,
        word varchar(100),
        action varchar(20) NOT NULL,
        original_content text NOT NULL,
        filtered_content text,
        created_at timestamptz NOT NULL DEFAULT NOW()
      );
    `;

    const createFilterLogsIndexes = `
      CREATE INDEX IF NOT EXISTS cfl_conversation_id_idx ON content_filter_logs(conversation_id);
      CREATE INDEX IF NOT EXISTS cfl_filter_type_idx ON content_filter_logs(filter_type);
      CREATE INDEX IF NOT EXISTS cfl_created_at_idx ON content_filter_logs(created_at);
    `;

    // 设置项
    const insertSettings = `
      INSERT INTO settings (key, value) VALUES
        ('content_filter_enabled', 'true'),
        ('sensitive_word_filter_enabled', 'true'),
        ('url_filter_enabled', 'true'),
        ('url_filter_mode', 'whitelist'),
        ('sensitive_word_default_action', 'block'),
        ('url_block_message', '抱歉,发送的链接不在白名单范围内')
      ON CONFLICT (key) DO NOTHING;
    `;

    // 执行迁移
    const statements = [
      createSensitiveWordsTable,
      createSensitiveWordsIndexes,
      createAllowedDomainsTable,
      createAllowedDomainsIndexes,
      createFilterLogsTable,
      createFilterLogsIndexes,
      insertSettings,
    ];

    for (const sql of statements) {
      const { error } = await supabase.rpc('exec', { sql });
      if (error) {
        logger.api.error('Migration SQL error', { error: error.message, sql: sql.substring(0, 100) });
        // 继续执行其他语句
      }
    }

    // 验证迁移结果
    const results = {
      tables: [] as string[],
      settings: [] as { key: string; value: string | null }[],
    };

    for (const table of ['content_sensitive_words', 'allowed_domains', 'content_filter_logs']) {
      const { error } = await supabase.from(table).select('id').limit(1);
      results.tables.push({
        ...{ name: table },
        status: error ? 'failed' : 'ok',
        error: error?.message,
      } as any);
    }

    for (const key of [
      'content_filter_enabled',
      'sensitive_word_filter_enabled',
      'url_filter_enabled',
      'url_filter_mode',
      'sensitive_word_default_action',
      'url_block_message'
    ]) {
      const { data } = await supabase.from('settings').select('value').eq('key', key).single();
      results.settings.push({ key, value: data?.value ?? null });
    }

    logger.api.info('Migration completed', { results });

    return NextResponse.json({
      success: true,
      message: 'Migration completed',
      results,
    });

  } catch (error) {
    logger.api.error('Migration failed', { error });
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

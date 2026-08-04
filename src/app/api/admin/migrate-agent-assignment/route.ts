/**
 * 坐席分配表迁移脚本
 */
import { withApi } from '@/lib/api/with-api';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async () => {
    try {
      const supabase = getSupabaseClient();

      const tables = ['agent_assignment_stats', 'shop_agent_bindings', 'agent_assignment_config'];
      const status: Record<string, { exists: boolean; columns?: string[]; rowCount?: number }> = {};

      for (const table of tables) {
        const { error } = await supabase.from(table).select('id').limit(1);

        if (error) {
          status[table] = { exists: false };
        } else {
          const { data: columns } = await supabase.rpc('exec', {
            sql: `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' AND table_schema = 'public' ORDER BY ordinal_position`,
          });

          const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });

          status[table] = {
            exists: true,
            columns: Array.isArray(columns) ? columns.map((c: { column_name: string }) => c.column_name) : undefined,
            rowCount: count ?? 0,
          };
        }
      }

      return new Response(JSON.stringify({ status }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async () => {
    try {
      const supabase = getSupabaseClient();

      logger.api.info('Starting agent assignment tables migration');

      const results: Record<string, { status: string; error?: string }> = {};

      // 1. Create agent_assignment_stats table
      try {
        const { error } = await supabase.rpc('exec', {
          sql: `
            CREATE TABLE IF NOT EXISTS agent_assignment_stats (
              id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              date DATE NOT NULL,
              assigned_count INT NOT NULL DEFAULT 0,
              active_conversations INT NOT NULL DEFAULT 0,
              completed_count INT NOT NULL DEFAULT 0,
              last_assigned_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              UNIQUE(user_id, date)
            );
          `,
        });
        if (error) throw error;

        await supabase.rpc('exec', {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_agent_assignment_stats_user_date ON agent_assignment_stats(user_id, date);
            CREATE INDEX IF NOT EXISTS idx_agent_assignment_stats_active_conversations ON agent_assignment_stats(active_conversations);
          `,
        });

        results.agent_assignment_stats = { status: 'ok' };
      } catch (err: unknown) {
        results.agent_assignment_stats = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }

      // 2. Create shop_agent_bindings table
      try {
        const { error } = await supabase.rpc('exec', {
          sql: `
            CREATE TABLE IF NOT EXISTS shop_agent_bindings (
              id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
              shop_id VARCHAR(36) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
              user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              priority INT NOT NULL DEFAULT 0,
              is_enabled BOOLEAN NOT NULL DEFAULT true,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              UNIQUE(shop_id, user_id)
            );
          `,
        });
        if (error) throw error;

        await supabase.rpc('exec', {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_shop_agent_bindings_shop ON shop_agent_bindings(shop_id);
            CREATE INDEX IF NOT EXISTS idx_shop_agent_bindings_user ON shop_agent_bindings(user_id);
          `,
        });

        results.shop_agent_bindings = { status: 'ok' };
      } catch (err: unknown) {
        results.shop_agent_bindings = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }

      // 3. Create agent_assignment_config table
      try {
        const { error } = await supabase.rpc('exec', {
          sql: `
            CREATE TABLE IF NOT EXISTS agent_assignment_config (
              id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
              strategy VARCHAR(30) NOT NULL,
              name VARCHAR(100) NOT NULL,
              is_enabled BOOLEAN NOT NULL DEFAULT true,
              condition_config JSONB,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ
            );
          `,
        });
        if (error) throw error;

        await supabase.rpc('exec', {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_agent_assignment_config_strategy ON agent_assignment_config(strategy);
            CREATE INDEX IF NOT EXISTS idx_agent_assignment_config_is_enabled ON agent_assignment_config(is_enabled);
          `,
        });

        results.agent_assignment_config = { status: 'ok' };
      } catch (err: unknown) {
        results.agent_assignment_config = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }

      const verification: Record<string, boolean> = {};
      for (const table of ['agent_assignment_stats', 'shop_agent_bindings', 'agent_assignment_config']) {
        const { error } = await supabase.from(table).select('id').limit(1);
        verification[table] = !error;
      }

      logger.api.info('Agent assignment migration completed', { results, verification });

      return new Response(JSON.stringify({ success: true, results, verification }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Agent assignment migration failed', { error });
      return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

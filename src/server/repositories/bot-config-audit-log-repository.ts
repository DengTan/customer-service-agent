/**
 * Repository for bot_config_audit_log.
 * Mirrors the pattern of ticket_audit_log (ticket-service.ts writeAuditLog).
 */
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export type AuditAction = 'create' | 'update' | 'delete';

export interface BotConfigAuditLogRow {
  id: string;
  bot_id: string;
  action: AuditAction;
  actor_id: string | null;
  actor_name: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface WriteAuditLogInput {
  botId: string;
  action: AuditAction;
  actorId?: string | null;
  actorName?: string | null;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export class BotConfigAuditLogRepository {
  private readonly client = getSupabaseClient();

  /**
   * Write a single audit log entry. Silently swallows errors so a logging
   * failure never blocks the main operation.
   */
  async write(input: WriteAuditLogInput): Promise<void> {
    if (isDemoMode()) return;

    try {
      const { error } = await this.client.from('bot_config_audit_log').insert({
        bot_id: input.botId,
        action: input.action,
        actor_id: input.actorId ?? null,
        actor_name: input.actorName ?? null,
        changes: input.changes ?? null,
        old_value: input.oldValue ?? null,
        new_value: input.newValue ?? null,
        metadata: input.metadata ?? null,
      });

      if (error) {
        throw new RepositoryError('write bot_config_audit_log', error.message, error.code);
      }
    } catch (err) {
      // Fire-and-forget: log but do not propagate
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('[BotConfigAuditLogRepository] Failed to write audit log:', msg);
    }
  }

  /**
   * List audit log entries for a specific bot, newest first.
   */
  async listByBotId(
    botId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<BotConfigAuditLogRow[]> {
    if (isDemoMode()) return [];

    const { limit = 50, offset = 0 } = options;

    const { data, error } = await this.client
      .from('bot_config_audit_log')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new RepositoryError('list bot_config_audit_log', error.message, error.code);
    }

    return (data as BotConfigAuditLogRow[]) ?? [];
  }

  /**
   * Count total audit entries for a bot.
   */
  async countByBotId(botId: string): Promise<number> {
    if (isDemoMode()) return 0;

    const { count, error } = await this.client
      .from('bot_config_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('bot_id', botId);

    if (error) {
      throw new RepositoryError('count bot_config_audit_log', error.message, error.code);
    }

    return count ?? 0;
  }
}

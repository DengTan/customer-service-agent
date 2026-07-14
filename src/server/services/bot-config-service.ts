import {
  BotConfigRepository,
  type BotConfigRow,
  type CreateBotConfigInput,
  type UpdateBotConfigInput,
} from '@/server/repositories/bot-config-repository';
import { BotConfigAuditLogRepository } from '@/server/repositories/bot-config-audit-log-repository';
import { SubAgentService } from './sub-agent-service';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

export interface BotDeleteGuard {
  subAgents: number;
  delegationsAsParent: number;
  delegationsAsChild: number;
  routingRules: number;
  hasReferences: boolean;
}

export interface AuditActor {
  id: string | null;
  name: string | null;
}

export class BotConfigService {
  constructor(
    private readonly repo = new BotConfigRepository(),
    private readonly subAgentService = new SubAgentService(),
    private readonly auditRepo = new BotConfigAuditLogRepository(),
  ) {}

  private async writeAuditLog(opts: {
    botId: string;
    action: 'create' | 'update' | 'delete';
    actor?: AuditActor;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    changes?: Record<string, { old: unknown; new: unknown }> | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.auditRepo.write({
      botId: opts.botId,
      action: opts.action,
      actorId: opts.actor?.id,
      actorName: opts.actor?.name,
      oldValue: opts.oldValue ?? null,
      newValue: opts.newValue ?? null,
      changes: opts.changes ?? null,
      metadata: opts.metadata ?? null,
    });
  }

  private computeFieldChanges(
    oldVal: Record<string, unknown>,
    newVal: Record<string, unknown>,
  ): Record<string, { old: unknown; new: unknown }> | null {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const allKeys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    for (const key of allKeys) {
      const oldV = oldVal[key];
      const newV = newVal[key];
      if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
        changes[key] = { old: oldV, new: newV };
      }
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }

  async listBots(includeSubAgents: boolean = true): Promise<{ bots: BotConfigRow[] }> {
    try {
      const bots = await this.repo.list(includeSubAgents);
      return { bots };
    } catch (error) {
      throw toServiceError(error, '获取Bot配置列表失败', 'DB_ERROR');
    }
  }

  async createBot(input: CreateBotConfigInput, actor?: AuditActor): Promise<{ bot: BotConfigRow }> {
    if (!input.name || !input.system_prompt) {
      throw new ServiceError('名称和系统提示词为必填项', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      // Enforce global main-bot cap
      if (!input.is_sub_agent) {
        await this.subAgentService.assertMainBotQuotaAvailable();
      }

      // Enforce the per-parent sub-agent cap whenever a sub-agent row is created
      // (covers the /api/bot-configs POST bypass alongside /api/sub-agents POST).
      if (input.is_sub_agent && input.parent_bot_id) {
        await this.subAgentService.assertSubAgentQuotaAvailable(input.parent_bot_id);
      }

      const bot = await this.repo.create(input);
      // Fire-and-forget audit log
      void this.writeAuditLog({
        botId: bot.id,
        action: 'create',
        actor,
        newValue: bot as unknown as Record<string, unknown>,
      });
      return { bot };
    } catch (error) {
      // Translate database-level cap triggers (P0003) to typed ServiceError
      // so the API layer can return a friendly 400 instead of a 500.
      // The actual quota distinction (main-bot vs sub-agent) is carried by
      // the error code emitted by the DB triggers, but we sniff the message
      // to forward the original friendly text verbatim.
      if (error instanceof ServiceError) throw error;
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string })?.message;
      if (code === 'MAX_BOT_QUOTA_EXCEEDED' || code === 'MAX_SUB_AGENTS_EXCEEDED' || code === 'MAX_MAIN_BOTS_EXCEEDED') {
        // Sub-agent trigger message contains both "主Bot" and "子Agent", so
        // check "子Agent" first (it is unique to the sub-agent cap message).
        // "主Bot" alone is ambiguous — it appears in both trigger messages.
        const isSubAgent = code === 'MAX_SUB_AGENTS_EXCEEDED' || message?.includes('子Agent');
        throw new ServiceError(message ?? (isSubAgent ? '子Agent数量已达上限' : '主Bot数量已达上限'), {
          status: 400,
          code: isSubAgent ? 'MAX_SUB_AGENTS_EXCEEDED' : 'MAX_MAIN_BOTS_EXCEEDED',
        });
      }
      throw toServiceError(error, '创建Bot配置失败', 'DB_ERROR');
    }
  }

  async updateBot(input: UpdateBotConfigInput, actor?: AuditActor): Promise<{ bot: BotConfigRow }> {
    if (!input.id) {
      throw new ServiceError('缺少Bot ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const existing = await this.repo.findById(input.id);
      if (!existing) {
        throw new ServiceError('Bot 不存在', { status: 404, code: 'NOT_FOUND' });
      }

      // If this update would create or re-activate a sub-agent under a parent,
      // make sure the parent has room. Covers the "flip a main bot into a
      // sub-agent via PUT" path and the "re-enable a previously disabled
      // sub-agent" path. The DB trigger remains a defense-in-depth check.
      const wouldBecomeActiveSubAgent =
        (input.is_sub_agent ?? existing.is_sub_agent) === true &&
        (input.status ?? existing.status) === 'active' &&
        (input.parent_bot_id !== undefined ? input.parent_bot_id : existing.parent_bot_id) != null;
      if (wouldBecomeActiveSubAgent) {
        const parentId =
          input.parent_bot_id !== undefined ? input.parent_bot_id : existing.parent_bot_id;
        if (parentId) {
          await this.subAgentService.assertSubAgentQuotaAvailable(parentId);
        }
      }

      const bot = await this.repo.update(input);
      const changes = this.computeFieldChanges(
        existing as unknown as Record<string, unknown>,
        bot as unknown as Record<string, unknown>,
      );
      // Fire-and-forget audit log
      void this.writeAuditLog({
        botId: bot.id,
        action: 'update',
        actor,
        oldValue: existing as unknown as Record<string, unknown>,
        newValue: bot as unknown as Record<string, unknown>,
        changes,
      });
      return { bot };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // Map repository-level concurrent update to 409
      const code = (error as { code?: string }).code;
      if (code === 'CONCURRENT_UPDATE') {
        throw new ServiceError('Bot 已被并发更新，请刷新后重试', {
          status: 409,
          code: 'CONCURRENT_UPDATE',
        });
      }
      if (code === 'MAX_SUB_AGENTS_EXCEEDED') {
        throw new ServiceError(
          (error as { message?: string })?.message ?? '子Agent数量已达上限',
          { status: 400, code: 'MAX_SUB_AGENTS_EXCEEDED' }
        );
      }
      if (code === 'MAX_BOT_QUOTA_EXCEEDED' || code === 'MAX_MAIN_BOTS_EXCEEDED') {
        const message = (error as { message?: string })?.message;
        // Sub-agent trigger message contains "子Agent"; main-bot message contains "主Bot".
        const isSubAgent = message?.includes('子Agent') ?? false;
        throw new ServiceError(message ?? (isSubAgent ? '子Agent数量已达上限' : '主Bot数量已达上限'), {
          status: 400,
          code: isSubAgent ? 'MAX_SUB_AGENTS_EXCEEDED' : 'MAX_MAIN_BOTS_EXCEEDED',
        });
      }
      throw toServiceError(error, '更新Bot配置失败', 'DB_ERROR');
    }
  }

  /**
   * Inspect how many references point at this bot before deletion.
   * The caller (admin UI) should show the counts and confirm before calling deleteBot.
   */
  async getDeleteGuard(id: string): Promise<BotDeleteGuard> {
    if (!id) {
      throw new ServiceError('缺少Bot ID', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const existing = await this.repo.findById(id);
      if (!existing) {
        throw new ServiceError('Bot 不存在', { status: 404, code: 'NOT_FOUND' });
      }
      const refs = await this.repo.countReferences(id);
      const hasReferences =
        refs.subAgents + refs.delegationsAsParent + refs.delegationsAsChild + refs.routingRules >
        0;
      return { ...refs, hasReferences };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '获取Bot引用关系失败', 'DB_ERROR');
    }
  }

  async deleteBot(id: string, opts: { force?: boolean; actor?: AuditActor } = {}): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少Bot ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const existing = await this.repo.findById(id);
      if (!existing) {
        throw new ServiceError('Bot 不存在', { status: 404, code: 'NOT_FOUND' });
      }

      if (!opts.force) {
        const refs = await this.repo.countReferences(id);
        const parts: string[] = [];
        if (refs.subAgents > 0) parts.push(`${refs.subAgents} 个子Agent`);
        if (refs.delegationsAsParent > 0)
          parts.push(`${refs.delegationsAsParent} 条以本Bot为父的委派记录`);
        if (refs.delegationsAsChild > 0)
          parts.push(`${refs.delegationsAsChild} 条以本Bot为子的委派记录`);
        if (refs.routingRules > 0)
          parts.push(`${refs.routingRules} 条引用本Bot的路由规则`);

        if (parts.length > 0) {
          throw new ServiceError(
            `Bot 仍被引用：${parts.join('；')}。请先清理引用后重试。`,
            { status: 409, code: 'HAS_REFERENCES' },
          );
        }
      } else {
        logger.warn('[BotConfigService] Force-deleting bot with references', { botId: id });
      }

      await this.repo.delete(id);
      // Fire-and-forget audit log (after successful delete)
      void this.writeAuditLog({
        botId: id,
        action: 'delete',
        actor: opts.actor,
        oldValue: existing as unknown as Record<string, unknown>,
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '删除Bot配置失败', 'DB_ERROR');
    }
  }

  async getAuditLog(botId: string, opts: { limit?: number; offset?: number } = {}) {
    return this.auditRepo.listByBotId(botId, opts);
  }
}

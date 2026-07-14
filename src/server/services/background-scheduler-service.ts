import { TicketService } from './ticket-service';
import { MarketingService } from './marketing-service';
import { KnowledgeLearningService } from './knowledge-learning-service';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { AlertRepository } from '@/server/repositories/alert-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { logger } from '@/lib/logger';
import { isDemoMode } from '@/storage/database/supabase-client';
import { clearChunkCache, getCacheStats } from './smart-chunking-service';

export interface SchedulerResult {
  ok: boolean;
  error?: string;
}

export interface UnhandledCheckResult extends SchedulerResult {
  checked: number;
  created: number;
}

export interface ScheduledCampaignsResult extends SchedulerResult {
  processed: number;
  errors: string[];
}

export interface KnowledgeLearningScanResult extends SchedulerResult {
  scanned: number;
  extracted: number;
}

export interface CacheCleanupResult extends SchedulerResult {
  cacheSize: number;
}

export interface RunAllResult {
  sla_check: SchedulerResult;
  unassigned_check: SchedulerResult;
  unhandled_check: UnhandledCheckResult;
  scheduled_campaigns: ScheduledCampaignsResult;
  knowledge_learning_scan: KnowledgeLearningScanResult;
  cache_cleanup: CacheCleanupResult;
}

export class BackgroundSchedulerService {
  private unhandledReminderRun: Promise<UnhandledCheckResult> | null = null;
  /**
   * Run SLA overdue check for all active tickets.
   */
  async runSLACheck(): Promise<SchedulerResult> {
    try {
      if (isDemoMode()) {
        return { ok: true };
      }
      const ticketService = new TicketService();
      await ticketService.checkSLAOverdue();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.agent.error('[BackgroundSchedulerService] runSLACheck failed', { error: msg });
      return { ok: false, error: msg };
    }
  }

  /**
   * Check for unassigned tickets that have been open too long and create alerts.
   */
  async runUnassignedCheck(): Promise<SchedulerResult> {
    try {
      if (isDemoMode()) {
        return { ok: true };
      }
      const ticketService = new TicketService();
      await ticketService.checkUnassignedTickets();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.agent.error('[BackgroundSchedulerService] runUnassignedCheck failed', { error: msg });
      return { ok: false, error: msg };
    }
  }

  /**
   * Scan active conversations where the last message is from the user and older than
   * the configured threshold, then create alerts for unhandled ones (with 1-hour dedup).
   *
   * Settings semantics (fixed 2026-07-13):
   *   - `unhandled_remind_enabled`:  'true'/'false' boolean toggle (default true)
   *   - `unhandled_remind_minutes`:  integer minutes (default 30)
   * The legacy `unhandled_remind` boolean is ignored; it was being
   * `parseInt`-ed as minutes and produced 0 minutes when set to 'true',
   * silently disabling the reminder.
   */
  runUnhandledReminder(): Promise<UnhandledCheckResult> {
    if (!this.unhandledReminderRun) {
      this.unhandledReminderRun = this.executeUnhandledReminder().finally(() => {
        this.unhandledReminderRun = null;
      });
    }
    return this.unhandledReminderRun;
  }

  private async executeUnhandledReminder(): Promise<UnhandledCheckResult> {
    try {
      if (isDemoMode()) {
        return { ok: true, checked: 0, created: 0 };
      }

      const settingsRepo = new SettingsRepository();
      const rows = await settingsRepo.list();
      const map = rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});

      const enabled = (map.unhandled_remind_enabled ?? 'true') === 'true';
      const unhandledMinutes = parseInt(map.unhandled_remind_minutes ?? '30', 10);

      if (!enabled || !Number.isFinite(unhandledMinutes) || unhandledMinutes <= 0) {
        return { ok: true, checked: 0, created: 0 };
      }

      const convRepo = new ConversationRepository();
      const alertRepo = new AlertRepository();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const unhandled = await convRepo.findUnhandledConversations(unhandledMinutes);
      let created = 0;

      for (const conv of unhandled) {
        const existing = await alertRepo.findRecentUnresolved(conv.id, 'unhandled_remind', oneHourAgo);
        if (!existing) {
          await alertRepo.create({
            conversation_id: conv.id,
            type: 'unhandled_remind',
            severity: 'warning',
            message: `对话 "${conv.title || '无标题'}" 已超过 ${unhandledMinutes} 分钟未处理`,
          });
          created++;
        }
      }

      return { ok: true, checked: unhandled.length, created };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.agent.error('[BackgroundSchedulerService] runUnhandledReminder failed', { error: msg });
      return { ok: false, checked: 0, created: 0, error: msg };
    }
  }

  /**
   * Execute all scheduled marketing campaigns whose scheduled_at time has passed.
   */
  async runScheduledCampaigns(): Promise<ScheduledCampaignsResult> {
    try {
      if (isDemoMode()) {
        return { ok: true, processed: 0, errors: [] };
      }
      const marketingService = new MarketingService();
      const result = await marketingService.processScheduledCampaigns();
      return { ok: true, processed: result.processed, errors: result.errors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.agent.error('[BackgroundSchedulerService] runScheduledCampaigns failed', { error: msg });
      return { ok: false, processed: 0, errors: [msg] };
    }
  }

  /**
   * Scan recent conversations and extract low-confidence AI replies as candidate knowledge.
   *
   * Honors the `knowledge_learning_auto_scan_enabled` setting. When the toggle is
   * disabled (default in FACTORY_DEFAULTS), the scan is a no-op so cron-driven runs
   * don't generate noise that admins haven't opted in to.
   */
  async runKnowledgeLearningScan(): Promise<KnowledgeLearningScanResult> {
    try {
      if (isDemoMode()) {
        return { ok: true, scanned: 0, extracted: 0 };
      }

      // Gate on the auto-scan toggle before doing any work
      const settingsRepo = new SettingsRepository();
      const enabledValue = await settingsRepo.get('knowledge_learning_auto_scan_enabled');
      if (enabledValue !== 'true') {
        return { ok: true, scanned: 0, extracted: 0 };
      }

      const service = new KnowledgeLearningService();
      const result = await service.scanConversations();
      return { ok: true, scanned: result.scanned, extracted: result.extracted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.agent.error('[BackgroundSchedulerService] runKnowledgeLearningScan failed', { error: msg });
      return { ok: false, scanned: 0, extracted: 0, error: msg };
    }
  }

  /**
   * Clear the smart chunking cache to free up memory.
   * Should be called periodically (e.g., every hour).
   */
  async runCacheCleanup(): Promise<CacheCleanupResult> {
    try {
      const stats = getCacheStats();
      clearChunkCache();
      logger.agent.debug('[BackgroundSchedulerService] Cache cleanup completed', { previousSize: stats.size });
      return { ok: true, cacheSize: stats.size };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.agent.error('[BackgroundSchedulerService] runCacheCleanup failed', { error: msg });
      return { ok: false, cacheSize: 0, error: msg };
    }
  }

  /**
   * Run all background tasks in parallel.
   */
  async runAll(): Promise<RunAllResult> {
    const [sla_check, unassigned_check, unhandled_check, scheduled_campaigns, knowledge_learning_scan, cache_cleanup] =
      await Promise.all([
        this.runSLACheck(),
        this.runUnassignedCheck(),
        this.runUnhandledReminder(),
        this.runScheduledCampaigns(),
        this.runKnowledgeLearningScan(),
        this.runCacheCleanup(),
      ]);
    return { sla_check, unassigned_check, unhandled_check, scheduled_campaigns, knowledge_learning_scan, cache_cleanup };
  }
}

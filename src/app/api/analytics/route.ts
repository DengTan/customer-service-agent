import { NextRequest } from 'next/server';
import { AnalyticsService } from '@/server/services/analytics-service';
import { AnalyticsRepository } from '@/server/repositories/analytics-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { apiSuccess, withErrorHandlerSimple, requirePermission } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const service = new AnalyticsService();
const analyticsRepo = new AnalyticsRepository();
const settingsRepo = new SettingsRepository();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'analytics', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const includeTickets = searchParams.get('include_tickets') === 'true';

  const result = await service.getAnalytics();

  if (includeTickets) {
    try {
      // 读取 SLA 配置，按优先级动态计算超时工单
      const slaResolveStr = await settingsRepo.get('ticket_sla_resolve_minutes');
      let slaResolveMinutes: Record<string, number> = {};
      if (slaResolveStr) {
        try {
          slaResolveMinutes = JSON.parse(slaResolveStr);
        } catch {
          logger.api.warn('[Analytics] invalid ticket_sla_resolve_minutes JSON, using defaults');
        }
      }

      const [ticketStats, ticketTrend, agentTicketStats] = await Promise.all([
        analyticsRepo.getTicketStats(slaResolveMinutes),
        analyticsRepo.getTicketTrend(7),
        analyticsRepo.getAgentTicketStats(),
      ]);
      (result as unknown as Record<string, unknown>).ticket_stats = ticketStats;
      (result as unknown as Record<string, unknown>).ticket_trend = ticketTrend;
      (result as unknown as Record<string, unknown>).agent_ticket_stats = agentTicketStats;
    } catch (error) {
      logger.api.error('[Analytics] ticket stats error', { error });
    }
  }

  return apiSuccess(result);
});

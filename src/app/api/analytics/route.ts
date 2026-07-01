import { NextRequest } from 'next/server';
import { AnalyticsService } from '@/server/services/analytics-service';
import { AnalyticsRepository } from '@/server/repositories/analytics-repository';
import { apiSuccess, withErrorHandlerSimple, requirePermission } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const service = new AnalyticsService();
const analyticsRepo = new AnalyticsRepository();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'analytics', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const includeTickets = searchParams.get('include_tickets') === 'true';

  const result = await service.getAnalytics();

  if (includeTickets) {
    try {
      const [ticketStats, ticketTrend, agentTicketStats] = await Promise.all([
        analyticsRepo.getTicketStats(),
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

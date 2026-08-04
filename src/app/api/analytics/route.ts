import { NextRequest } from 'next/server';
import { AnalyticsService } from '@/server/services/analytics-service';
import { AnalyticsRepository } from '@/server/repositories/analytics-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { apiSuccess } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';
import { logger } from '@/lib/logger';

const service = new AnalyticsService();
const analyticsRepo = new AnalyticsRepository();
const settingsRepo = new SettingsRepository();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'analytics', action: 'read' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const includeTickets = searchParams.get('include_tickets') === 'true';

  const result = await service.getAnalytics();

  if (includeTickets) {
    try {
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
}, );

export { GETHandler as GET };

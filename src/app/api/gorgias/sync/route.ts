/**
 * Gorgias 全量同步 API
 *
 * GET /api/gorgias/sync - 获取同步状态
 * POST /api/gorgias/sync - 执行全量同步
 */

import { gorgiasService } from '@/server/services/gorgias-service';
import { gorgiasSyncService } from '@/server/services/gorgias-sync-service';
import { withApi } from '@/lib/api/with-api';
import { isDemoMode } from '@/storage/database/supabase-client';
import { getLogger } from '@/lib/logger';
import { getSettingsRepository } from '@/server/repositories/settings-repository';

const logger = getLogger('GorgiasSyncAPI');
const LAST_SYNC_KEY = 'gorgias_last_sync';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const action = searchParams.get('action');

      // 检查 Gorgias 是否可用
      const isAvailable = await gorgiasService.isAvailable();
      if (!isAvailable) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Gorgias integration is not configured or disabled'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      if (action === 'status') {
        const webhookStatus = await gorgiasService.getWebhookStatus();
        const webhookUrl = await gorgiasService.getWebhookUrl();
        const webhookSecret = await gorgiasService.getWebhookSecret();

        return new Response(JSON.stringify({
          success: true,
          webhook: {
            enabled: webhookStatus.enabled,
            integration_id: webhookStatus.integrationId,
            triggers: webhookStatus.triggers,
            url: webhookUrl,
            has_secret: !!webhookSecret
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (action === 'tickets') {
        const tickets = await gorgiasService.getTickets({ limit: 10 });
        return new Response(JSON.stringify({
          success: true,
          tickets: tickets.tickets.map(t => ({
            id: t.id,
            subject: t.subject,
            status: t.status,
            customer_email: t.customerEmail,
            created_at: t.createdAt
          })),
          has_more: tickets.hasMore
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const webhookStatus = await gorgiasService.getWebhookStatus();
      const settingsRepo = getSettingsRepository();
      const lastSync = await settingsRepo.get(LAST_SYNC_KEY);

      return new Response(JSON.stringify({
        success: true,
        sync_enabled: webhookStatus.enabled,
        last_sync: lastSync
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
      logger.error('Gorgias sync status error', {
        error: error instanceof Error ? error.message : String(error)
      });

      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    try {
      if (isDemoMode()) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Demo mode - sync not available'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const isAvailable = await gorgiasService.isAvailable();
      if (!isAvailable) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Gorgias integration is not configured'
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const body = await request.json().catch(() => ({}));
      const {
        type = 'full',
        since = null
      } = body as { type?: string; since?: string | null };

      logger.info('Gorgias sync started', { type, since });

      const syncResults = {
        tickets_created: 0,
        tickets_updated: 0,
        messages_synced: 0,
        errors: [] as string[]
      };

      let cursor: string | null = null;
      let hasMore = true;
      const limit = 50;

      while (hasMore) {
        try {
          const result = await gorgiasService.getTickets({
            limit,
            cursor: cursor || undefined
          });

          for (const ticket of result.tickets) {
            try {
              const syncResult = await gorgiasSyncService.syncTicket(ticket.id);
              if (syncResult.action === 'created') {
                syncResults.tickets_created++;
              } else {
                syncResults.tickets_updated++;
              }
            } catch (err) {
              syncResults.errors.push(`Ticket ${ticket.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }

          cursor = result.cursor;
          hasMore = result.hasMore && !!cursor;

        } catch (err) {
          logger.error('Gorgias sync batch error', {
            error: err instanceof Error ? err.message : String(err)
          });
          syncResults.errors.push(`Batch error: ${err instanceof Error ? err.message : 'Unknown error'}`);
          break;
        }
      }

      logger.info('Gorgias sync completed', syncResults);

      const settingsRepo = getSettingsRepository();
      const syncTimestamp = new Date().toISOString();
      await settingsRepo.set(LAST_SYNC_KEY, syncTimestamp);

      return new Response(JSON.stringify({
        success: true,
        type,
        results: syncResults,
        synced_at: syncTimestamp
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
      logger.error('Gorgias sync error', {
        error: error instanceof Error ? error.message : String(error)
      });

      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
);

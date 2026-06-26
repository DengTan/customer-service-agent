/**
 * Gorgias 全量同步 API
 * 
 * GET /api/gorgias/sync
 *   - 触发全量同步，返回同步状态
 * 
 * POST /api/gorgias/sync
 *   - 执行全量同步
 */

import { NextRequest, NextResponse } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { gorgiasSyncService } from '@/server/services/gorgias-sync-service';
import { requireRole } from '@/lib/api-utils';
import { isDemoMode } from '@/storage/database/supabase-client';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasSyncAPI');

/**
 * 获取同步状态
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    // Admin 权限验证
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    // 检查 Gorgias 是否可用
    const isAvailable = await gorgiasService.isAvailable();
    if (!isAvailable) {
      return NextResponse.json({
        success: false,
        error: 'Gorgias integration is not configured or disabled'
      }, { status: 400 });
    }

    if (action === 'status') {
      // 获取 Webhook 状态
      const webhookStatus = await gorgiasService.getWebhookStatus();
      const webhookUrl = await gorgiasService.getWebhookUrl();
      const webhookSecret = await gorgiasService.getWebhookSecret();
      
      return NextResponse.json({
        success: true,
        webhook: {
          enabled: webhookStatus.enabled,
          integration_id: webhookStatus.integrationId,
          triggers: webhookStatus.triggers,
          url: webhookUrl,
          has_secret: !!webhookSecret
        }
      });
    }

    if (action === 'tickets') {
      // 获取最近的工单列表（用于预览）
      const tickets = await gorgiasService.getTickets({ limit: 10 });
      return NextResponse.json({
        success: true,
        tickets: tickets.tickets.map(t => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          customer_email: t.customerEmail,
          created_at: t.createdAt
        })),
        has_more: tickets.hasMore
      });
    }

    // 默认返回同步状态概览
    const webhookStatus = await gorgiasService.getWebhookStatus();
    
    return NextResponse.json({
      success: true,
      sync_enabled: webhookStatus.enabled,
      last_sync: null // TODO: 记录最后同步时间
    });

  } catch (error) {
    logger.error('Gorgias sync status error', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * 执行全量同步
 */
export async function POST(request: NextRequest) {
  try {
    // Admin 权限验证
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    if (isDemoMode()) {
      return NextResponse.json({
        success: false,
        error: 'Demo mode - sync not available'
      }, { status: 400 });
    }

    // 检查 Gorgias 是否可用
    const isAvailable = await gorgiasService.isAvailable();
    if (!isAvailable) {
      return NextResponse.json({
        success: false,
        error: 'Gorgias integration is not configured'
      }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { 
      type = 'full',  // full | incremental
      since = null     // ISO datetime for incremental sync
    } = body;

    logger.info('Gorgias sync started', { type, since });

    // 获取所有工单
    const syncResults = {
      tickets_created: 0,
      tickets_updated: 0,
      messages_synced: 0,
      errors: [] as string[]
    };

    // 分页获取工单
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

    return NextResponse.json({
      success: true,
      type,
      results: syncResults,
      synced_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Gorgias sync error', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

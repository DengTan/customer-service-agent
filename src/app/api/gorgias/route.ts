/**
 * Gorgias API 统一入口
 * 提供连接状态检查
 */

import { NextRequest, NextResponse } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { gorgiasRepository } from '@/server/repositories/gorgias-repository';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasAPI');

/**
 * GET /api/gorgias
 * 获取 Gorgias 连接状态
 */
export async function GET(request: NextRequest) {
  try {
    // 任何登录用户都可以查看连接状态
    const authError = await requireRole(request, ['observer', 'agent', 'admin']);
    if (authError) return authError;

    const status = await gorgiasService.getConnectionStatus();

    // 获取 Webhook 诊断信息
    let webhookDiagnostics: Record<string, unknown> | null = null;
    try {
      const { isDemoMode, getSupabaseClient } = await import('@/storage/database/supabase-client');
      
      if (!isDemoMode()) {
        const supabase = getSupabaseClient();
        
        // 读取 Gorgias 配置
        const { data: settingsData } = await supabase
          .from('settings')
          .select('key, value')
          .in('key', ['gorgias_enabled', 'gorgias_webhook_enabled', 'gorgias_webhook_secret', 'gorgias_public_url']);
        
        const settingsMap = new Map((settingsData || []).map((s: { key: string; value: string }) => [s.key, s.value]));
        const gorgiasEnabled = settingsMap.get('gorgias_enabled') === 'true';
        const webhookEnabled = settingsMap.get('gorgias_webhook_enabled') === 'true';
        
        if (gorgiasEnabled && webhookEnabled) {
          const diagnostics: Record<string, unknown> = {};
          
          // 4. 检查 publicUrl 是否配置（提前定义，供后续使用）
          const publicUrl = settingsMap.get('gorgias_public_url');
          diagnostics.publicUrlConfigured = !!publicUrl;
          if (publicUrl) {
            diagnostics.webhookEndpoint = `${publicUrl}/api/gorgias/webhook`;
          }

          // 1. 检查 Gorgias 侧 Integration 是否存在（传入 webhookUrl 以支持 URL 匹配）
          const webhookEndpointForCheck = publicUrl ? `${publicUrl}/api/gorgias/webhook?secret=${settingsMap.get('gorgias_webhook_secret')}` : undefined;
          try {
            const integration = await gorgiasRepository.getWebhookIntegration(webhookEndpointForCheck);
            diagnostics.integrationFound = !!integration;
            if (integration) {
              diagnostics.integrationId = integration.id;
              diagnostics.integrationName = integration.name;
              if (integration.http) {
                diagnostics.triggers = integration.http.triggers;
                diagnostics.targetUrl = integration.http.url ? '(已配置)' : '(未配置)';
              }
            } else {
              diagnostics.integrationFound = false;
              diagnostics.hint = 'Gorgias 中未找到 SmartAssist Webhook Integration，请重新保存设置以注册';
            }
          } catch (err) {
            diagnostics.integrationCheckError = err instanceof Error ? err.message : 'Unknown error';
          }

          // 2. 检查数据库中最近处理的 Webhook 事件
          try {
            const { data: recentEvents, error: eventsError } = await supabase
              .from('webhook_event_processed')
              .select('event_id, event_type, processed_at')
              .order('processed_at', { ascending: false })
              .limit(5);

            if (!eventsError && recentEvents) {
              diagnostics.recentProcessedEvents = recentEvents.length;
              diagnostics.lastEventAt = recentEvents.length > 0 ? recentEvents[0].processed_at : null;
              diagnostics.lastEventType = recentEvents.length > 0 ? recentEvents[0].event_type : null;
            } else if (eventsError) {
              diagnostics.eventsTableError = eventsError.message;
            }
          } catch (err) {
            diagnostics.eventsCheckError = err instanceof Error ? err.message : 'Unknown error';
          }

          // 3. 检查 Secret 是否配置
          diagnostics.secretConfigured = !!settingsMap.get('gorgias_webhook_secret');

          webhookDiagnostics = diagnostics;
        }
      }
    } catch (err) {
      logger.error('Failed to get webhook diagnostics', { error: err instanceof Error ? err.message : 'Unknown' });
    }

    return NextResponse.json({
      available: status.available,
      cache: status.cacheStats,
      webhook: webhookDiagnostics,
      message: status.available 
        ? 'Gorgias API is connected and ready'
        : 'Gorgias API is not configured or not available',
    });
  } catch (err) {
    logger.error('Failed to get Gorgias status', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json(
      { error: 'Failed to check Gorgias status' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gorgias
 * 清除 Gorgias 缓存
 */
export async function DELETE(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    gorgiasService.clearCache();

    return NextResponse.json({
      success: true,
      message: 'Gorgias cache cleared',
    });
  } catch (err) {
    logger.error('Failed to clear Gorgias cache', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}

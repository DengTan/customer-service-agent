import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { SettingsService } from '@/server/services/settings-service';
import {
  invalidateKnowledgeSearchSettingsCache,
} from '@/server/services/knowledge-search-service';
import { ContentFilterService } from '@/server/services/content-filter-service';
import { logger } from '@/lib/logger';

const settingsService = new SettingsService();
const ADMIN_ONLY = ['admin'];

/**
 * GET /api/settings
 *
 * Returns the system settings map. Only admins may receive the full
 * map; non-admin roles get the settings with sensitive keys (API keys,
 * webhook secrets, system prompt, etc.) stripped out. The endpoint
 * never returns 200 with secrets for non-admin callers — non-admin
 * callers who shouldn't see settings at all get 403 instead.
 */
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const settings = await settingsService.getSettingsMap(true);
  return apiSuccess({ settings });
});

/**
 * PUT /api/settings
 *
 * Applies a validated settings batch. Sensitive keys (LLM API keys,
 * webhook secrets, etc.) are NOT accepted through this endpoint; they
 * must be updated via their dedicated API routes.
 */
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const raw = body?.settings;
  const validationResult = SettingsService.validateSettings(raw);

  if (!validationResult.valid) {
    logger.security.warn('[Settings] PUT rejected: invalid keys or values', {
      invalidKeys: validationResult.invalidKeys,
      invalidValues: validationResult.invalidValues,
    });
    return apiSuccess({
      success: false,
      error: '保存失败：包含不支持的设置键或无效的值。',
      detail: {
        invalidKeys: validationResult.invalidKeys,
        invalidValues: validationResult.invalidValues,
      },
    });
  }

  await settingsService.updateSettings(validationResult.filtered);

  // Invalidate cached knowledge-search settings so new thresholds take effect
  // immediately for the next message processed.
  try {
    invalidateKnowledgeSearchSettingsCache();
  } catch (err) {
    logger.warn('[Settings] Cache invalidation after PUT failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Also invalidate the content-filter cache — toggles like
  // content_filter_enabled, sensitive_word_filter_enabled, url_filter_enabled,
  // url_filter_mode, sensitive_word_default_action, and the block/warn messages
  // all change filter behaviour without any RPC touching the rules table, so
  // the only safe behaviour is to drop the cache.
  try {
    new ContentFilterService().clearCache();
  } catch (err) {
    logger.warn('[Settings] Content-filter cache invalidation after PUT failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return apiSuccess({});
});
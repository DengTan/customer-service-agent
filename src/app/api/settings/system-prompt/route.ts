/**
 * `PUT /api/settings/system-prompt`
 *
 * Dedicated narrow-scope endpoint for updating the system_prompt setting.
 *
 * Security model (Phase 1 of `settings-rls-hardening_5c312208.plan.md`):
 *   - Admin-only: `requireRole(['admin'])` gate.
 *   - system_prompt is REMOVED from WRITABLE_SETTING_KEYS so the generic
 *     PUT /api/settings endpoint will reject it with SETTINGS_KEY_NOT_WRITABLE.
 *   - system_prompt is added to NON_RESETTABLE_KEYS so factory reset cannot
 *     overwrite it — the operator's custom prompt is preserved across resets.
 *   - This endpoint bypasses the generic allowlist and performs its own
 *     length validation before writing.
 *
 * Cache invalidation:
 *   - Invalidates knowledge-search settings cache.
 *   - Invalidates feature-flag cache.
 *   - Clears content-filter cache.
 *
 * This file lives at src/app/api/settings/system-prompt/route.ts so it
 * receives the same Next.js route-group treatment as /api/settings/reset.
 */
import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { invalidateKnowledgeSearchSettingsCache } from '@/server/services/knowledge-search-service';
import { ContentFilterService } from '@/server/services/content-filter-service';
import { FeatureFlagService } from '@/server/services/feature-flag-service';
import { logger } from '@/lib/logger';
import { getServiceRoleClient } from '@/storage/database/supabase-client';

const ADMIN_ONLY = ['admin'];

// Maximum allowed length for system_prompt (4 000 chars — mirrors FREE_TEXT_KEYS cap in settings-service.ts)
const MAX_SYSTEM_PROMPT_LENGTH = 4_000;

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  // ── Auth gate ──────────────────────────────────────────────────────────────
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  // ── Parse body ────────────────────────────────────────────────────────────
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const rawPrompt = body?.system_prompt;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (rawPrompt === undefined) {
    return apiSuccess({
      success: false,
      error: '缺少 system_prompt 字段',
      code: 'MISSING_FIELD',
    }, 400);
  }

  if (typeof rawPrompt !== 'string') {
    return apiSuccess({
      success: false,
      error: 'system_prompt 必须是字符串',
      code: 'INVALID_TYPE',
    }, 400);
  }

  if (rawPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return apiSuccess({
      success: false,
      error: `system_prompt 超出最大长度限制 (${MAX_SYSTEM_PROMPT_LENGTH} 字符)`,
      code: 'VALUE_TOO_LONG',
      detail: { maxLength: MAX_SYSTEM_PROMPT_LENGTH, actualLength: rawPrompt.length },
    }, 400);
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  const client = getServiceRoleClient();
  const repo = new SettingsRepository(client);

  try {
    await repo.set('system_prompt', rawPrompt);
    logger.info('[Settings/SystemPrompt] system_prompt updated', {
      promptLength: rawPrompt.length,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('[Settings/SystemPrompt] Failed to update system_prompt', { error: errMsg });
    return apiSuccess({
      success: false,
      error: '保存 system_prompt 失败',
      detail: errMsg,
    }, 500);
  }

  // ── Invalidate downstream caches ────────────────────────────────────────────
  try {
    invalidateKnowledgeSearchSettingsCache();
  } catch { /* non-fatal */ }

  try {
    new ContentFilterService().clearCache();
  } catch { /* non-fatal */ }

  try {
    FeatureFlagService.invalidateCache();
  } catch { /* non-fatal */ }

  return apiSuccess({});
});

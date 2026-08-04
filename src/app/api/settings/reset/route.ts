/**
 * POST /api/settings/reset
 * "恢复出厂设置" endpoint
 */
import { withApi } from '@/lib/api/with-api';
import { RESETTABLE_DEFAULTS } from '@/lib/settings-schema';
import { getSettingsRepository } from '@/server/repositories/settings-repository';
import { RepositoryError } from '@/server/repositories/repository-error';
import { logger } from '@/lib/logger';

function isFactoryResetRequest(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  if (typeof body === 'object' && Object.keys(body as object).length === 0) return true;
  return false;
}

export const POST = withApi(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'write' },
  },
  async ({ request }) => {
    let body: unknown;
    let bodyMalformed = false;
    try {
      const raw = await request.text();
      if (raw === '') {
        body = undefined;
      } else {
        try {
          body = JSON.parse(raw);
        } catch {
          bodyMalformed = true;
        }
      }
    } catch {
      bodyMalformed = true;
    }

    if (bodyMalformed) {
      logger.security.warn('[Settings/Reset] Rejected malformed reset payload', {});
      return new Response(JSON.stringify({ ok: false, error: '重置请求体不是合法的 JSON', code: 'RESET_PAYLOAD_MALFORMED' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!isFactoryResetRequest(body)) {
      logger.security.warn('[Settings/Reset] Rejected non-empty reset payload from client', {
        payloadKeys: Object.keys(body as object),
      });
      return new Response(JSON.stringify({ ok: false, error: '重置请求体必须为空', code: 'RESET_PAYLOAD_NOT_EMPTY' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const defaults = RESETTABLE_DEFAULTS as Record<string, string>;
    const allowedKeys = Object.keys(defaults);

    logger.info('[Settings/Reset] Initiating factory reset', {
      keyCount: allowedKeys.length,
      hasSystemPrompt: 'system_prompt' in defaults,
    });

    const repo = getSettingsRepository();
    try {
      await repo.resetToDefaults(defaults, allowedKeys);
    } catch (err) {
      if (err instanceof RepositoryError) {
        logger.error('[Settings/Reset] RPC failed', {
          code: err.code,
          message: err.message,
        });
        return new Response(JSON.stringify({ ok: false, error: '重置设置失败', code: 'RESET_RPC_FAILED' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }

    return new Response(JSON.stringify({ ok: true, resetCount: allowedKeys.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

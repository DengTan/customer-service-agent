/**
 * `POST /api/settings/reset`
 *
 * "恢复出厂设置" endpoint.
 *
 * Security contract (phase 1 of `settings-rls-hardening_5c312208.plan.md`):
 *   - Admin-only: `requireRole(['admin'])` gate.
 *   - Empty body / `{}` → factory reset with server-fixed RESETTABLE_DEFAULTS.
 *   - Non-empty body → 400 REJECTED. The server NEVER accepts a client-supplied
 *     reset scope; the allowlist is baked into the source of truth
 *     (`src/lib/settings-schema.ts:RESETTABLE_DEFAULTS`) and passed as
 *     `p_allowed_keys` to the `reset_settings_to_defaults` RPC.
 *   - The RPC rejects any key not in the server-supplied allowlist.
 *
 * Remote DB behaviour (SQL-level only, not unit-testable):
 *   - `ON CONFLICT DO UPDATE`: existing values ARE overwritten (factory reset
 *     semantics — intentionally overwrites admin customisations).
 *   - Advisory lock: concurrent resets are serialised at the DB level.
 *   - The `p_allowed_keys` intersection: enforced entirely in SQL.
 *
 * No destructive remote operations in this implementation — callers MUST
 * provide SUPABASE_SERVICE_ROLE_KEY for the RPC to succeed.
 */
import { NextRequest } from 'next/server';
import { apiSuccess, apiError, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { RESETTABLE_DEFAULTS } from '@/lib/settings-schema';
import { getSettingsRepository } from '@/server/repositories/settings-repository';
import { RepositoryError } from '@/server/repositories/repository-error';
import { logger } from '@/lib/logger';

const ADMIN_ONLY = ['admin'];

/**
 * Determine whether `body` represents an intentional reset request (empty/nil)
 * or a client-supplied payload that must be rejected.
 *
 * Returns `true` for:
 *   - `undefined` (no body / empty POST)
 *   - `null`
 *   - `{}` (empty object explicitly sent by the client)
 *
 * Returns `false` (→ 400) for any object with one or more own enumerable keys.
 * Note: a non-object body (string, array, number) is also rejected here,
 * because `parseJsonBody` already handles the JSON-syntax failure case.
 */
function isFactoryResetRequest(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  if (typeof body === 'object' && Object.keys(body as object).length === 0) return true;
  return false;
}

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // ── Auth gate ──────────────────────────────────────────────────────────────
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  // ── Parse body ────────────────────────────────────────────────────────────
  // Phase 2 change: malformed JSON now returns 400 RESET_PAYLOAD_MALFORMED.
  // Previously the route silently coerced parse errors to `undefined`,
  // which collapsed into the "empty body" branch and could mask a buggy /
  // hostile client that failed to construct a JSON body.
  //
  // We distinguish three cases:
  //   1. Truly empty body (Content-Length 0 / no body) → `body = undefined`,
  //      treated as the "factory reset" intent.
  //   2. Body parses as valid JSON → use the parsed value.
  //   3. Body is non-empty but JSON syntax is invalid → 400 malformed.
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
    return apiError('重置请求体不是合法的 JSON', {
      status: 400,
      code: 'RESET_PAYLOAD_MALFORMED',
      internalMessage: 'request body is not valid JSON',
    });
  }

  // ── Payload contract: reject non-empty bodies ─────────────────────────────
  // The reset scope is server-fixed. Any non-empty body is a client-supplied
  // scope attempt and must be rejected, regardless of key contents.
  if (!isFactoryResetRequest(body)) {
    logger.security.warn('[Settings/Reset] Rejected non-empty reset payload from client', {
      payloadKeys: Object.keys(body as object),
    });
    return apiError('重置请求体必须为空', {
      status: 400,
      code: 'RESET_PAYLOAD_NOT_EMPTY',
      internalMessage: `Non-empty reset body received: ${JSON.stringify(body)}`,
    });
  }

  // ── Build the RPC call ───────────────────────────────────────────────────
  // Server is the authority for both the defaults and the allowed-key set.
  // This is the trust boundary that prevents clients from injecting
  // non-resettable keys (integration secrets, custom_tools, etc.).
  const defaults = RESETTABLE_DEFAULTS as Record<string, string>;
  const allowedKeys = Object.keys(defaults);

  logger.info('[Settings/Reset] Initiating factory reset', {
    keyCount: allowedKeys.length,
    hasSystemPrompt: 'system_prompt' in defaults,
  });

  // ── Call the privileged reset RPC ─────────────────────────────────────────
  const repo = getSettingsRepository();
  try {
    await repo.resetToDefaults(defaults, allowedKeys);
  } catch (err) {
    if (err instanceof RepositoryError) {
      logger.error('[Settings/Reset] RPC failed', {
        code: err.code,
        message: err.message,
      });
      return apiError('重置设置失败', {
        status: 500,
        code: 'RESET_RPC_FAILED',
        internalMessage: err.message,
      });
    }
    throw err;
  }

  return apiSuccess({ resetCount: allowedKeys.length });
});

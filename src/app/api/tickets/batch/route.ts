/**
 * PATCH /api/tickets/batch — sprint 4 (T-2 / TS-2).
 *
 * Wraps the existing `TicketService.batchUpdate` in Sprint 1's `idempotent()`
 * so client retries (network blips, double-clicks) collapse into a single
 * execution and a `SKIPPED` response carries the cached outcome of the first
 * attempt.
 *
 * Key strategy:
 * - Client MAY send `Idempotency-Key` header (UUID or any opaque string).
 * - When missing, server generates a UUID but DOES NOT use it as the
 *   idempotency key — without a client-controlled value retries cannot be
 *   detected. Instead the body `requestId` field is used. If neither is set,
 *   the operation runs without idempotency (matching prior behavior).
 * - Window: 60 seconds. After that the same `requestId` is treated as a new
 *   operation.
 * - Scope: in-memory. Cross-instance dedup would require `scope: 'persistent'`
 *   and was deliberately deferred — see Risks section.
 *
 * Backward compatibility: identical success / error responses when idempotency
 * is bypassed; with idempotency, the response gains a `duplicate: true` flag
 * so the client can reason about retries.
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';
import { idempotent, SKIPPED, createIdempotencyKey, fnv1a64 } from '@/lib/idempotency';

const ticketService = new TicketService();
const BATCH_IDEMPOTENCY_WINDOW_MS = 60_000;

interface BatchBody {
  ids?: string[];
  updates?: {
    status?: string;
    assignee_id?: string | null;
    priority?: string;
    category?: string;
  };
  /**
   * Client-supplied request ID. When present, the same `requestId` colliding
   * within the dedup window is treated as a retry and short-circuits. Server
   * MAY generate one if absent, but the auto-generated value is not used as a
   * key — see header comment.
   */
  requestId?: string;
}

export const PATCH = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request }) => {
    const body = await request.json().catch(() => ({})) as BatchBody;

    const ids = body?.ids ?? [];
    const updates = body?.updates ?? {};
    const clientRequestId = body?.requestId ?? request.headers.get('Idempotency-Key') ?? null;

    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: '请选择至少一个工单', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ error: '请提供更新字段', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // No client-supplied request ID → skip idempotency (backward-compatible).
    if (!clientRequestId) {
      const result = await ticketService.batchUpdate(ids, updates);
      return new Response(JSON.stringify({ ok: true, updated_count: result.updated_count }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stable key from the requestId + the canonicalized body. Hash the body
    // (NOT just the requestId) so two distinct batches sharing the same id by
    // accident still produce different keys.
    const bodyFingerprint = fnv1a64(JSON.stringify({ ids: [...ids].sort(), updates }));
    const idempotencyKey = createIdempotencyKey('batch_tickets', clientRequestId, bodyFingerprint);

    const result = await idempotent(
      { key: idempotencyKey, windowMs: BATCH_IDEMPOTENCY_WINDOW_MS, scope: 'memory', rollbackOnError: true },
      async () => ticketService.batchUpdate(ids, updates),
    );

    if (result.value === SKIPPED) {
      return new Response(JSON.stringify({
        ok: true,
        duplicate: true,
        idempotencyKey,
        attempts: result.attempts,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      ok: true,
      duplicate: false,
      updated_count: result.value.updated_count,
      idempotencyKey,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
);

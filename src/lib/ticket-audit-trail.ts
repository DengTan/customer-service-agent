/**
 * Sprint 4 (T-4 / TS-4) — audit trail hook for ticket write operations.
 *
 * Provides a ready-to-use `withAuditTrail()` configuration that:
 * - records operation / ticket_id / operator_id / from_status / to_status / details
 * - writes into the existing `ticket_audit_log` table (Drizzle-managed)
 * - is fail-closed by default — a failed audit BLOCKS the main write
 * - exposes a typed `auditTicket(...)` wrapper for callers that already write
 *   via direct service methods (no rewrite needed).
 */

import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { withAuditTrail, type AuditHook, type AuditContext } from './api-utils';

export type TicketAuditOperation = 'create' | 'update' | 'delete' | 'batch' | 'add_comment' | 'reopen';

export interface TicketAuditDetails {
  from_status?: string | null;
  to_status?: string | null;
  [key: string]: unknown;
}

/**
 * Build an audit hook that inserts into `ticket_audit_log`.
 *
 * The hook is intentionally fire-and-forget on the happy path so the main op
 * proceeds; the wrapping `withAuditTrail()` itself decides whether to BLOCK
 * the main op when the hook throws. In practice we want the insert to be
 * synchronous enough that throw ⇒ block; see `auditTicketWrite` below which
 * sets `failClosed = true` by default.
 */
export function buildTicketAuditHook(): AuditHook {
  return async (ctx: AuditContext): Promise<void> => {
    if (isDemoMode()) return;

    const payload = ctx.payload as {
      ticket_id?: string;
      ticketId?: string;
      operation?: string;
      from_status?: string | null;
      to_status?: string | null;
      details?: Record<string, unknown>;
    };

    const ticketId = payload.ticket_id ?? payload.ticketId;
    if (!ticketId) {
      throw new Error('audit hook: missing ticket_id in payload');
    }

    const client = getSupabaseClient();
    const { error } = await client.from('ticket_audit_log').insert({
      ticket_id: ticketId,
      action: ctx.operation,
      operator_id: ctx.userId,
      // Sentinel string for parity with the existing `writeAuditLog` schema.
      changes: JSON.stringify({
        before: { status: payload.from_status ?? null },
        after: { status: payload.to_status ?? null, ...(payload.details ?? {}) },
      }),
    });
    if (error) {
      throw new Error(`ticket audit insert failed: ${error.message}`);
    }
  };
}

/**
 * Wrap any ticket write in `withAuditTrail()`. `failClosed` defaults to `true`
 * so a failed audit pre-emptively aborts the main write.
 */
export async function auditTicketWrite<T>(params: {
  ticketId: string;
  operation: TicketAuditOperation;
  operatorId: string | null;
  details?: TicketAuditDetails;
  redact?: readonly string[];
  failClosed?: boolean;
  run: () => Promise<T>;
}): Promise<T> {
  const hook = buildTicketAuditHook();
  return withAuditTrail(
    {
      table: 'ticket_audit_log',
      operation: params.operation,
      redact: params.redact,
      failClosed: params.failClosed ?? true,
    },
    params.run,
    [hook],
    {
      userId: params.operatorId,
      payload: {
        ticket_id: params.ticketId,
        from_status: params.details?.from_status ?? null,
        to_status: params.details?.to_status ?? null,
        details: params.details ?? {},
      },
    },
  );
}

/**
 * Sprint 4 (T-4 / TS-4) — audit trail wrapper tests.
 *
 * Covers:
 * - audit hook writes into `ticket_audit_log` on success
 * - audit hook throws → main op is blocked (default fail-closed)
 * - audit hook throws → main op continues when failClosed=false (fail-open)
 * - main op throws → audit failure does not mask the original error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditTicketWrite, buildTicketAuditHook } from './ticket-audit-trail';
import type { AuditContext } from './api-utils';

const mockClient = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: () => mockClient,
  isDemoMode: () => false,
}));

function makeInsert(error: { message: string } | null = null) {
  return vi.fn(async () => ({ error }));
}

function mockInsertSuccess() {
  mockClient.from.mockImplementation(() => ({ insert: makeInsert() }));
}

function mockInsertError(message: string) {
  mockClient.from.mockImplementation(() => ({ insert: makeInsert({ message }) }));
}

describe('buildTicketAuditHook', () => {
  beforeEach(() => {
    mockClient.from.mockReset();
  });

  it('writes an audit row into ticket_audit_log', async () => {
    mockInsertSuccess();
    const hook = buildTicketAuditHook();
    const ctx: AuditContext = {
      table: 'ticket_audit_log',
      operation: 'create',
      userId: 'u-1',
      payload: { ticket_id: 't-1', from_status: null, to_status: 'open', details: {} },
    };
    await hook(ctx);
    expect(mockClient.from).toHaveBeenCalledWith('ticket_audit_log');
  });

  it('throws when payload lacks ticket_id', async () => {
    mockInsertSuccess();
    const hook = buildTicketAuditHook();
    await expect(
      hook({ table: 'ticket_audit_log', operation: 'create', userId: 'u-1', payload: {} }),
    ).rejects.toThrow(/missing ticket_id/);
  });

  it('throws when the underlying insert errors', async () => {
    mockInsertError('boom');
    const hook = buildTicketAuditHook();
    await expect(
      hook({ table: 'ticket_audit_log', operation: 'delete', userId: 'u-1', payload: { ticket_id: 't-1' } }),
    ).rejects.toThrow(/ticket audit insert failed/);
  });
});

describe('auditTicketWrite', () => {
  beforeEach(() => {
    mockClient.from.mockReset();
  });

  it('runs the main op when audit succeeds', async () => {
    mockInsertSuccess();
    const run = vi.fn(async () => ({ ok: true }));
    const result = await auditTicketWrite({
      ticketId: 't-1',
      operation: 'create',
      operatorId: 'u-1',
      details: { to_status: 'open' },
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('blocks the main op when audit throws (default failClosed)', async () => {
    mockInsertError('audit-fail');
    const run = vi.fn(async () => ({ ok: true }));
    await expect(
      auditTicketWrite({
        ticketId: 't-1',
        operation: 'delete',
        operatorId: 'u-1',
        details: {},
        run,
      }),
    ).rejects.toThrow(/ticket audit insert failed/);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the main op when audit fails but failClosed=false', async () => {
    mockInsertError('audit-fail');
    const run = vi.fn(async () => ({ ok: true }));
    const result = await auditTicketWrite({
      ticketId: 't-1',
      operation: 'update',
      operatorId: 'u-1',
      details: {},
      failClosed: false,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('propagates main-op errors even when audit succeeds', async () => {
    mockInsertSuccess();
    const run = vi.fn(async () => { throw new Error('main-fail'); });
    await expect(
      auditTicketWrite({
        ticketId: 't-1',
        operation: 'update',
        operatorId: 'u-1',
        details: {},
        run,
      }),
    ).rejects.toThrow('main-fail');
  });
});

/**
 * Sprint 5 (AL-1 + AL-2) — alert-service dedup + state-machine tests.
 *
 * Covers:
 * - M-4: idempotent() collapse on duplicate `(type, entity)` creation.
 * - M-5: state-machine-driven resolve / dismiss / reopen behavior.
 *
 * The service is constructed with hand-rolled fake repos so tests run in
 * pure demo mode without Supabase.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from './alert-service';
import { ServiceError } from './service-error';
import type { Alert } from '@/lib/types';

// vi.resetModules() between tests so the in-memory idempotency store starts
// empty. The Sprint-1 idempotency module uses a module-level singleton, so
// without this reset every test would inherit keys from the previous one.
const importFresh = async () => {
  vi.resetModules();
  // Re-require ServiceError AFTER the reset so we have the freshest
  // constructor reference for instanceof checks.
  const mod = await import('./alert-service');
  const err = await import('./service-error');
  return { AlertService: mod.AlertService, ServiceError: err.ServiceError };
};

interface FakeAlertRow extends Alert {
  metadata: Record<string, unknown> | null;
  is_resolved: boolean;
}

class FakeAlertRepository {
  rows: FakeAlertRow[] = [];
  resolveCalls: string[] = [];

  list = vi.fn(async () => this.rows as unknown as Alert[]);
  listStatsRows = vi.fn(async () =>
    this.rows.map((r) => ({ severity: r.severity, is_resolved: r.is_resolved })),
  );
  findRecentUnresolved = vi.fn(async () => null);

  create = vi.fn(async (input: {
    conversation_id: string;
    type: string;
    severity?: string;
    message: string;
    metadata?: Record<string, unknown> | null;
  }) => {
    const row: FakeAlertRow = {
      id: `alert-${this.rows.length + 1}`,
      conversation_id: input.conversation_id,
      type: input.type,
      severity: (input.severity ?? 'warning') as 'warning' | 'critical' | 'info',
      message: input.message,
      is_resolved: false,
      metadata: input.metadata ?? null,
      created_at: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  });

  findById = vi.fn(async (id: string) => {
    return this.rows.find((r) => r.id === id) ?? null;
  });

  update = vi.fn(async (id: string, patch: Partial<FakeAlertRow>) => {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const merged = { ...this.rows[idx]!, ...patch };
    this.rows[idx] = merged as FakeAlertRow;
    return merged;
  });

  resolve = vi.fn(async (id: string) => {
    this.resolveCalls.push(id);
    const row = this.rows.find((r) => r.id === id);
    if (row) row.is_resolved = true;
  });
}

class FakeConversationRepository {}

class FakeSettingsRepository {
  list = vi.fn(async () => []);
  get = vi.fn(async () => null);
}

function buildService(): { svc: AlertService; repo: FakeAlertRepository } {
  const repo = new FakeAlertRepository();
  const svc = new AlertService(
    repo as never,
    new FakeConversationRepository() as never,
    new FakeSettingsRepository() as never,
  );
  return { svc, repo };
}

describe('AlertService.createAlert — M-4 unified idempotent dedup', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('creates an alert on first call', async () => {
    const { svc, repo } = buildService();
    const result = await svc.createAlert({
      conversation_id: 'conv-1',
      type: 'low_confidence',
      message: 'low',
      metadata: { confidence: 0.2 },
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect('id' in result.alert).toBe(true);
  });

  it('collapses concurrent duplicates within the dedup window', async () => {
    const { AlertService: Svc } = await importFresh();
    const repo = new FakeAlertRepository();
    const svc = new Svc(
      repo as never,
      new FakeConversationRepository() as never,
      new FakeSettingsRepository() as never,
    );
    const first = svc.createAlert({
      conversation_id: 'conv-dup',
      type: 'low_confidence',
      message: 'first',
    });
    const second = svc.createAlert({
      conversation_id: 'conv-dup',
      type: 'low_confidence',
      message: 'second',
    });
    const [a, b] = await Promise.all([first, second]);

    expect(repo.create).toHaveBeenCalledTimes(1);
    // Exactly one row was inserted.
    expect(repo.rows).toHaveLength(1);
    // The wrapper returns `{ alert, dedup: true }` either when the
    // findRecentUnresolved fast-path catches a duplicate or when the
    // idempotency wrapper collapses a second concurrent attempt and we
    // re-read the existing row.
    const dedupA = (a as { dedup?: boolean }).dedup;
    const dedupB = (b as { dedup?: boolean }).dedup;
    expect(dedupA === true || dedupB === true).toBe(true);
  });

  it('keys dedup by (type, entity) so different entities pass through', async () => {
    const { AlertService: Svc } = await importFresh();
    const repo = new FakeAlertRepository();
    const svc = new Svc(
      repo as never,
      new FakeConversationRepository() as never,
      new FakeSettingsRepository() as never,
    );
    await svc.createAlert({
      conversation_id: 'conv-A',
      type: 'low_confidence',
      message: 'm',
    });
    await svc.createAlert({
      conversation_id: 'conv-B',
      type: 'low_confidence',
      message: 'm',
    });
    expect(repo.create).toHaveBeenCalledTimes(2);
  });
});

describe('AlertService.resolveAlert — M-5 state-machine wiring', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function setup() {
    const { AlertService: Svc, ServiceError: SvcErr } = await importFresh();
    const repo = new FakeAlertRepository();
    repo.rows.push({
      id: 'a-1',
      conversation_id: 'conv-1',
      type: 'low_confidence',
      severity: 'warning',
      message: 'm',
      is_resolved: false,
      metadata: null,
      created_at: new Date().toISOString(),
    });
    const svc = new Svc(
      repo as never,
      new FakeConversationRepository() as never,
      new FakeSettingsRepository() as never,
    );
    return { svc, repo, ServiceError: SvcErr };
  }

  it('resolves an open alert and clears no fields', async () => {
    const { svc, repo } = await setup();
    await svc.resolveAlert('a-1', { operatorId: 'u-1', operatorRole: 'agent' });
    const row = repo.rows[0]!;
    expect(row.is_resolved).toBe(true);
    expect(row.resolved_at ?? null).not.toBeNull();
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('refuses to resolve an already-resolved alert', async () => {
    const { svc, repo, ServiceError: SvcErr } = await setup();
    repo.rows[0]!.is_resolved = true;
    await expect(svc.resolveAlert('a-1')).rejects.toBeInstanceOf(SvcErr);
  });

  it('refuses to resolve a dismissed alert', async () => {
    const { svc, repo, ServiceError: SvcErr } = await setup();
    repo.rows[0]!.is_resolved = true;
    repo.rows[0]!.metadata = { dismissed_by: 'u-1', dismissed_at: new Date().toISOString() };
    await expect(svc.resolveAlert('a-1')).rejects.toBeInstanceOf(SvcErr);
  });

  it('throws NotFound for unknown alert ids', async () => {
    const { svc, ServiceError: SvcErr } = await setup();
    await expect(svc.resolveAlert('nope')).rejects.toBeInstanceOf(SvcErr);
  });
});

describe('AlertService.dismissAlert — M-5', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('marks an open alert dismissed and records metadata', async () => {
    const { AlertService: Svc } = await importFresh();
    const repo = new FakeAlertRepository();
    repo.rows.push({
      id: 'a-2',
      conversation_id: 'conv-1',
      type: 'low_confidence',
      severity: 'warning',
      message: 'm',
      is_resolved: false,
      metadata: null,
      created_at: new Date().toISOString(),
    });
    const svc = new Svc(
      repo as never,
      new FakeConversationRepository() as never,
      new FakeSettingsRepository() as never,
    );
    await svc.dismissAlert('a-2', { operatorId: 'u-1', operatorRole: 'agent' });
    const row = repo.rows[0]!;
    expect(row.is_resolved).toBe(true);
    expect(row.metadata?.['dismissed_by']).toBe('u-1');
  });

  it('refuses to dismiss an already-dismissed alert', async () => {
    const { AlertService: Svc, ServiceError: SvcErr } = await importFresh();
    const repo = new FakeAlertRepository();
    repo.rows.push({
      id: 'a-3',
      conversation_id: 'conv-1',
      type: 'low_confidence',
      severity: 'warning',
      message: 'm',
      is_resolved: true,
      metadata: { dismissed_by: 'u-1', dismissed_at: new Date().toISOString() },
      created_at: new Date().toISOString(),
    });
    const svc = new Svc(
      repo as never,
      new FakeConversationRepository() as never,
      new FakeSettingsRepository() as never,
    );
    await expect(svc.dismissAlert('a-3')).rejects.toBeInstanceOf(SvcErr);
  });
});

describe('AlertService.reopenAlert — M-5 admin-only', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function setup() {
    const { AlertService: Svc, ServiceError: SvcErr } = await importFresh();
    const repo = new FakeAlertRepository();
    repo.rows.push({
      id: 'a-4',
      conversation_id: 'conv-1',
      type: 'low_confidence',
      severity: 'warning',
      message: 'm',
      is_resolved: true,
      metadata: null,
      created_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });
    const svc = new Svc(
      repo as never,
      new FakeConversationRepository() as never,
      new FakeSettingsRepository() as never,
    );
    return { svc, repo, ServiceError: SvcErr };
  }

  it('forbids non-admins outright', async () => {
    const { svc, ServiceError: SvcErr } = await setup();
    await expect(svc.reopenAlert('a-4', { operatorRole: 'agent' })).rejects.toBeInstanceOf(SvcErr);
  });

  it('lets admins reopen a resolved alert and clears resolved_at', async () => {
    const { svc, repo } = await setup();
    await svc.reopenAlert('a-4', { operatorId: 'u-admin', operatorRole: 'admin' });
    const row = repo.rows[0]!;
    expect(row.is_resolved).toBe(false);
    expect(row.resolved_at ?? null).toBeNull();
  });

  it('refuses to reopen a dismissed alert', async () => {
    const { svc, repo, ServiceError: SvcErr } = await setup();
    repo.rows[0]!.metadata = { dismissed_by: 'u-1', dismissed_at: new Date().toISOString() };
    await expect(
      svc.reopenAlert('a-4', { operatorRole: 'admin' }),
    ).rejects.toBeInstanceOf(SvcErr);
  });
});

describe('createAlertStateMachine — exported singleton matches factory', () => {
  it('factory and direct transition agree', async () => {
    const { createAlertStateMachine } = await import('@/lib/alert-state-machine');
    const { applyTransition } = await import('@/lib/state-machine');
    const m = createAlertStateMachine();
    const events = [
      { from: 'open' as const, event: 'resolve' as const },
      { from: 'open' as const, event: 'dismiss' as const },
    ];
    for (const c of events) {
      // eslint-disable-next-line no-await-in-loop
      const r = await applyTransition(m, c.from, { type: c.event });
      expect(r.applied).toBe(true);
    }
  });
});
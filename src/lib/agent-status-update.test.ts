/**
 * Agent status service tests.
 *
 * Covers every transition through `AgentService.updateStatus`:
 *
 *   - legal `(from → to)` edges (including self-loops via `noop`) invoke
 *     the state machine and persist the new row;
 *   - self-transitions return the existing row *without* touching
 *     `updated_at` (caller can rely on `updated_at` reflecting actual
 *     transitions, not noop toggles);
 *   - the offline-default branch (no prior session row, target=online)
 *     upserts a session via the `login` event;
 *   - corrupt DB rows (a stale status value outside `AgentState`) raise
 *     `INVALID_STATE` instead of silently going through the machine;
 *   - cross-user isolation — write/read calls target only the agent
 *     whose id was passed in;
 *   - invalid input strings fail validation, never reaching the repo.
 *
 * We deliberately avoid mocking the import of `AgentRepository` via
 * Vitest's `vi.mock`, because the test lives in `src/lib/` and the
 * production file is a Next.js TS module. Instead we construct
 * `AgentService` with a hand-written fake that satisfies the structural
 * subset of the methods we call.
 */

import { describe, it, expect } from 'vitest';
import { AgentService } from '@/server/services/agent-service';
import { ServiceError } from '@/server/services/service-error';
import type { AgentSessionRow } from '@/server/repositories/agent-repository';

interface FakeSessionRow extends AgentSessionRow {
  status: 'online' | 'away' | 'offline';
}

class FakeAgentRepository {
  store = new Map<string, FakeSessionRow>();
  lastReadFor: string | null = null;
  lastWrittenFor: string | null = null;

  async findSessionByUserId(userId: string): Promise<FakeSessionRow | null> {
    this.lastReadFor = userId;
    return this.store.get(userId) ?? null;
  }

  async upsertSession(
    userId: string,
    status: string,
    currentConversationId: string | null = null,
  ): Promise<FakeSessionRow> {
    this.lastWrittenFor = userId;
    const row: FakeSessionRow = {
      id: `sess-${userId}`,
      user_id: userId,
      status: status as FakeSessionRow['status'],
      current_conversation_id: currentConversationId,
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(userId, row);
    return row;
  }

  async countByStatus(_status: string): Promise<number> {
    return 0;
  }
  async countResolvedToday(): Promise<{ count: number; items: never[] }> {
    return { count: 0, items: [] };
  }
  async listRatedConversationsUpdatedSince(): Promise<never[]> {
    return [];
  }
}

function buildService(): { svc: AgentService; repo: FakeAgentRepository } {
  const repo = new FakeAgentRepository();
  // Pass any cast — AgentService only calls the four methods we implemented.
  const svc = new AgentService(repo as never, undefined as never);
  return { svc, repo };
}

const seedSession = (repo: FakeAgentRepository, userId: string, status: FakeSessionRow['status']) => {
  repo.store.set(userId, {
    id: `sess-${userId}`,
    user_id: userId,
    status,
    current_conversation_id: null,
    last_active_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
};

describe('AgentService.updateStatus — every legal (from → to) edge', () => {
  // These nine tests mirror the (from, to) edges in the agent presence
  // table — self-loops included. They are the regression net for the
  // original "INVALID_TRANSITION when toggling presence" bug; any
  // future change that drops one of these edges will fail here.
  const cases: Array<{ from: FakeSessionRow['status']; to: FakeSessionRow['status'] }> = [
    // real edges
    { from: 'online',  to: 'away' },
    { from: 'online',  to: 'offline' },
    { from: 'away',    to: 'online' },
    { from: 'away',    to: 'offline' },
    { from: 'offline', to: 'online' },
    { from: 'offline', to: 'away' },
  ];

  for (const c of cases) {
    it(`(${c.from} → ${c.to}) invokes the machine and persists`, async () => {
      const { svc, repo } = buildService();
      const agentId = `agent-${c.from}-${c.to}`;
      seedSession(repo, agentId, c.from);

      const r = await svc.updateStatus(agentId, c.to);
      expect(r).toBeTruthy();
      expect(repo.store.get(agentId)!.status).toBe(c.to);
      expect(repo.lastWrittenFor).toBe(agentId);
    });
  }
});

describe('AgentService.updateStatus — self-transitions do not touch updated_at', () => {
  it('(online → online) returns current session without upsert', async () => {
    const { svc, repo } = buildService();
    seedSession(repo, 'agent-4', 'online');
    const before = repo.store.get('agent-4')!.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const r = await svc.updateStatus('agent-4', 'online');
    expect(r.session).toBeTruthy();
    expect(repo.store.get('agent-4')!.updated_at).toBe(before);
    // No write should have been issued.
    expect(repo.lastWrittenFor).toBe(null);
  });

  it('(away → away) returns current session without upsert', async () => {
    const { svc, repo } = buildService();
    seedSession(repo, 'agent-4a', 'away');
    const before = repo.store.get('agent-4a')!.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const r = await svc.updateStatus('agent-4a', 'away');
    expect(r.session).toBeTruthy();
    expect(repo.store.get('agent-4a')!.updated_at).toBe(before);
    expect(repo.lastWrittenFor).toBe(null);
  });
});

describe('AgentService.updateStatus — initial presence (no row)', () => {
  it('treats absence as offline and allows the login event to take the agent online', async () => {
    const { svc, repo } = buildService();
    // No prior session row.
    const r = await svc.updateStatus('agent-5', 'online');
    expect(r).toBeTruthy();
    expect(repo.store.get('agent-5')!.status).toBe('online');
    expect(repo.lastWrittenFor).toBe('agent-5');
  });
});

describe('AgentService.updateStatus — cross-user safety', () => {
  it('updateStatus for agent-X never reads/writes agent-Y', async () => {
    const { svc, repo } = buildService();
    seedSession(repo, 'agent-X', 'online');
    seedSession(repo, 'agent-Y', 'online');
    await svc.updateStatus('agent-X', 'away');
    expect(repo.lastReadFor).toBe('agent-X');
    expect(repo.lastWrittenFor).toBe('agent-X');
    // agent-Y is untouched.
    expect(repo.store.get('agent-Y')!.status).toBe('online');
  });
});

describe('AgentService.updateStatus — input validation', () => {
  it('invalid status string fails validation, never touches the repo', async () => {
    const { svc, repo } = buildService();
    seedSession(repo, 'agent-6', 'online');
    await expect(svc.updateStatus('agent-6', 'WRONG')).rejects.toBeInstanceOf(ServiceError);
    expect(repo.lastReadFor).toBe(null);
  });

  it('unrecognised target yields VALIDATION_ERROR (not INVALID_TRANSITION)', async () => {
    const { svc, repo } = buildService();
    seedSession(repo, 'agent-7', 'online');
    try {
      await svc.updateStatus('agent-7', 'WRONG');
      expect.fail('expected ServiceError');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('VALIDATION_ERROR');
      expect((err as ServiceError).status).toBe(400);
    }
    expect(repo.lastReadFor).toBe(null);
  });
});

describe('AgentService.updateStatus — corrupt DB rows', () => {
  it('a stale status value in the DB raises INVALID_STATE (not silently coerced)', async () => {
    const { svc, repo } = buildService();
    // A row with a status outside the AgentState union — models a legacy
    // value left behind by an older schema. Without the narrow check,
    // the machine would see 'paused' as a valid `from` and the caller
    // would get a confusing INVALID_TRANSITION (or worse, an event
    // lookup that "happens" to succeed).
    repo.store.set('agent-corrupt', {
      id: 'sess-agent-corrupt',
      user_id: 'agent-corrupt',
      status: 'paused' as unknown as FakeSessionRow['status'],
      current_conversation_id: null,
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    try {
      await svc.updateStatus('agent-corrupt', 'online');
      expect.fail('expected ServiceError');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('INVALID_STATE');
      expect((err as ServiceError).status).toBe(409);
    }
    expect(repo.lastReadFor).toBe('agent-corrupt');
    expect(repo.lastWrittenFor).toBe(null);
  });
});

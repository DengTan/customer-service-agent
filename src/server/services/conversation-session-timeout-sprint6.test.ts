/**
 * Sprint 6 (C-5) — `ConversationService.checkSessionTimeout` idempotency.
 *
 * Spec coverage:
 *   - happy path: idle conversation → status flipped to 'ended',
 *     idempotency key acquired
 *   - race: two concurrent calls → only ONE update fires (the second
 *     returns the first caller's result via the idempotency store)
 *   - already terminated: status 'ended' → no update, returns false
 *   - not yet idle: returns false (no transition)
 *   - invalid timeoutMinutes (≤0): returns null, never queries
 *   - missing conversationId: throws before any side effect
 */

import { describe, it, expect } from 'vitest';
import { ConversationService } from '@/server/services/conversation-service';
import type { Conversation } from '@/lib/types';

class FakeConversationRepository {
  rows: Map<string, Conversation> = new Map();
  updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
  // Track findSessionInfo invocations separately for assertions.
  sessionInfoCalls: string[] = [];

  async findById(id: string): Promise<Conversation | null> {
    return this.rows.get(id) ?? null;
  }
  async update(id: string, patch: Record<string, unknown>): Promise<void> {
    this.updateCalls.push({ id, patch });
    const existing = this.rows.get(id);
    if (existing) {
      this.rows.set(id, { ...existing, ...patch } as Conversation);
    }
  }
  async findSessionInfo(id: string): Promise<{
    id: string;
    status: string;
    message_count: number;
    updated_at: string;
    created_at: string;
  } | null> {
    this.sessionInfoCalls.push(id);
    const row = this.rows.get(id);
    if (!row) return null;
    return {
      id,
      status: row.status,
      message_count: 0,
      updated_at: row.updated_at ?? new Date().toISOString(),
      created_at: row.created_at ?? new Date().toISOString(),
    };
  }
  async list() {
    return { conversations: [], total: 0, statusCounts: {} };
  }
  async create() {
    return {} as Conversation;
  }
  async insertMessage() {}
  async incrementMessageCount() {}
  async findCollaboration() {
    return null;
  }
  async insertMessageAndReturn() {
    return {} as never;
  }
  async listMessageHistory() {
    return [];
  }
  async getSummary() {
    return null;
  }
  async updateSummary() {}
  async markHandoff() {}
  async updateAndReturn(id: string, patch: Record<string, unknown>): Promise<Conversation> {
    const existing = this.rows.get(id);
    return { ...(existing as Conversation), ...patch } as Conversation;
  }
  async delete() {}
  async deleteMessages() {}
  async countMessages() {
    return 0;
  }
  async countUserMessages() {
    return 0;
  }
  async listParticipants() {
    return [];
  }
  async getFirstAssistantReplyAt() {
    return null;
  }
}

function buildService() {
  const repo = new FakeConversationRepository();
  const svc = new ConversationService(repo as never);
  return { svc, repo };
}

function seed(repo: FakeConversationRepository, id: string, opts: { status?: string; updatedAt?: string } = {}) {
  const updatedAt = opts.updatedAt ?? new Date(Date.now() - 60 * 60_000).toISOString(); // 1 hour ago by default
  repo.rows.set(id, {
    id,
    status: opts.status ?? 'active',
    updated_at: updatedAt,
    created_at: updatedAt,
  } as unknown as Conversation);
}

describe('C-5: checkSessionTimeout — idempotent transition', () => {
  it('happy path: idle conversation → status flipped to ended (exactly one update)', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-idle');

    const result = await svc.checkSessionTimeout({
      conversationId: 'conv-idle',
      timeoutMinutes: 30,
    });

    expect(result).toBe(true);
    expect(repo.updateCalls.length).toBe(1);
    expect(repo.updateCalls[0]?.patch['status']).toBe('ended');
  });

  it('race: two concurrent calls produce exactly ONE update', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-race');

    const [a, b] = await Promise.all([
      svc.checkSessionTimeout({ conversationId: 'conv-race', timeoutMinutes: 30 }),
      svc.checkSessionTimeout({ conversationId: 'conv-race', timeoutMinutes: 30 }),
    ]);

    // At least one of them must report true (the first to acquire).
    expect([a, b].filter((x) => x === true).length).toBeGreaterThanOrEqual(1);
    // And the underlying update must have been called exactly once.
    expect(repo.updateCalls.length).toBe(1);
  });

  it('already-ended conversation: no update, returns false', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-already-ended', { status: 'ended' });

    const result = await svc.checkSessionTimeout({
      conversationId: 'conv-already-ended',
      timeoutMinutes: 30,
    });

    expect(result).toBe(false);
    expect(repo.updateCalls.length).toBe(0);
  });

  it('not yet idle: returns false, no transition', async () => {
    const { svc, repo } = buildService();
    // updatedAt is NOW (just touched).
    seed(repo, 'conv-fresh', { status: 'active', updatedAt: new Date().toISOString() });

    const result = await svc.checkSessionTimeout({
      conversationId: 'conv-fresh',
      timeoutMinutes: 30,
    });

    expect(result).toBe(false);
    expect(repo.updateCalls.length).toBe(0);
  });

  it('invalid timeoutMinutes (≤0): returns null, never queries session info', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-no-timeout');

    const result = await svc.checkSessionTimeout({
      conversationId: 'conv-no-timeout',
      timeoutMinutes: 0,
    });

    expect(result).toBeNull();
    expect(repo.sessionInfoCalls.length).toBe(0);
    expect(repo.updateCalls.length).toBe(0);
  });

  it('missing conversationId: throws before any side effect', async () => {
    const { svc, repo } = buildService();
    await expect(
      svc.checkSessionTimeout({ conversationId: '', timeoutMinutes: 30 }),
    ).rejects.toThrow();
    expect(repo.updateCalls.length).toBe(0);
    expect(repo.sessionInfoCalls.length).toBe(0);
  });
});
/**
 * Sprint 6 (C-4) — `ConversationService.endConversation` audit trail.
 *
 * Spec coverage:
 *   - happy path: status moves from active -> ended; audit hook called
 *     with conversation_id, operator_id, from_status, to_status,
 *     summary_hash
 *   - fail-closed: audit hook throws → main update is BLOCKED (status
 *     does NOT change in the repo)
 *   - idempotency: calling endConversation twice does NOT record two
 *     audit rows (because the first call already moved status to
 *     'ended', so the second short-circuits)
 *   - summary_hash: identical summaries produce identical hashes;
 *     different summaries produce different hashes (deterministic)
 *   - missing conversationId rejected before the hook fires
 */

import { describe, it, expect } from 'vitest';
import { ConversationService } from '@/server/services/conversation-service';
import type { Conversation } from '@/lib/types';

class FakeConversationRepository {
  rows: Map<string, Conversation> = new Map();
  updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];

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

function seed(repo: FakeConversationRepository, id: string, opts: { status?: string; summary?: string } = {}) {
  repo.rows.set(id, {
    id,
    status: opts.status ?? 'active',
    summary: opts.summary ?? 'Customer asked about shipping.',
  } as unknown as Conversation);
}

describe('C-4: endConversation audit trail (fail-closed)', () => {
  it('happy path: audit hook called with full payload + status moved to ended', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-1', { status: 'active', summary: 'Inquiry about refund' });

    const captured: Array<{ payload: Record<string, unknown>; userId: string | null; operation: string }> = [];
    await svc.endConversation({
      conversationId: 'conv-1',
      operatorId: 'u-agent-1',
      auditHook: async (ctx) => {
        captured.push({ payload: ctx.payload, userId: ctx.userId, operation: ctx.operation });
      },
    });

    expect(captured.length).toBe(1);
    expect(captured[0]?.operation).toBe('conversation_ended');
    expect(captured[0]?.userId).toBe('u-agent-1');
    expect(captured[0]?.payload['conversation_id']).toBe('conv-1');
    expect(captured[0]?.payload['from_status']).toBe('active');
    expect(captured[0]?.payload['to_status']).toBe('ended');
    expect(captured[0]?.payload['summary_hash']).toMatch(/^[a-f0-9]{64}$/);

    expect(repo.updateCalls.length).toBe(1);
    expect(repo.updateCalls[0]?.patch['status']).toBe('ended');
  });

  it('fail-closed: audit hook throws → main update is BLOCKED', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-fail-closed', { status: 'active' });

    const failingHook = async () => {
      throw new Error('audit insert failed');
    };

    await expect(
      svc.endConversation({
        conversationId: 'conv-fail-closed',
        operatorId: 'u-1',
        auditHook: failingHook,
      }),
    ).rejects.toThrow(/audit insert failed/);

    // The repository update must NOT have been called.
    expect(repo.updateCalls).toEqual([]);
    // The status must remain 'active' — defensive read.
    expect(repo.rows.get('conv-fail-closed')?.status).toBe('active');
  });

  it('idempotent: calling endConversation twice does not produce two audit rows', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-once', { status: 'active' });

    const auditCalls: number[] = [];
    const hook = async () => {
      auditCalls.push(1);
    };

    await svc.endConversation({ conversationId: 'conv-once', operatorId: 'u-1', auditHook: hook });
    // Second call: status is now 'ended', so endConversation short-circuits.
    await svc.endConversation({ conversationId: 'conv-once', operatorId: 'u-1', auditHook: hook });

    expect(auditCalls.length).toBe(1);
    // The repository's update was only invoked once.
    expect(repo.updateCalls.length).toBe(1);
  });

  it('summary_hash is deterministic and reflects the summary content', async () => {
    const { svc, repo } = buildService();
    seed(repo, 'conv-hash-A', { summary: 'same content' });
    seed(repo, 'conv-hash-B', { summary: 'same content' });
    seed(repo, 'conv-hash-C', { summary: 'DIFFERENT' });

    const captured: Record<string, string> = {};
    const hook = async (ctx: { payload: Record<string, unknown> }) => {
      captured[String(ctx.payload['conversation_id'])] = String(ctx.payload['summary_hash']);
    };

    await svc.endConversation({ conversationId: 'conv-hash-A', operatorId: 'u', auditHook: hook });
    await svc.endConversation({ conversationId: 'conv-hash-B', operatorId: 'u', auditHook: hook });
    await svc.endConversation({ conversationId: 'conv-hash-C', operatorId: 'u', auditHook: hook });

    // Same summary → same hash.
    expect(captured['conv-hash-A']).toBe(captured['conv-hash-B']);
    // Different summary → different hash.
    expect(captured['conv-hash-A']).not.toBe(captured['conv-hash-C']);
  });

  it('missing conversationId is rejected before the hook fires', async () => {
    const { svc, repo } = buildService();
    const auditCalls: number[] = [];
    await expect(
      svc.endConversation({
        conversationId: '',
        operatorId: 'u-1',
        auditHook: async () => {
          auditCalls.push(1);
        },
      }),
    ).rejects.toThrow();
    expect(auditCalls).toEqual([]);
    expect(repo.updateCalls).toEqual([]);
  });
});
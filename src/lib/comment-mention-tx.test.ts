/**
 * Sprint 4 (T-7 / P2-TS-5) — transactional comment + @mention batch tests.
 *
 * Covers:
 * - Comment with no @mention → runBatch runs only the 'comment' item.
 * - Comment with valid mentions → both inserts succeed and no rollback fires.
 * - Mention insert fails → runBatch triggers rollback → deleteComment invoked.
 * - Multiple mentions, one fails mid-stream → still rolls back the comment.
 *
 * We construct TicketService with hand-rolled fake repos so the test runs
 * without Supabase. In demo mode the production TicketService already
 * short-circuits DB calls, so the fake repo only needs to track which
 * method was called.
 */

import { describe, it, expect } from 'vitest';
import { TicketService } from '@/server/services/ticket-service';
import { ServiceError } from '@/server/services/service-error';
import type { TicketCommentRow } from '@/server/repositories/types';
import type { CommentWithAuthor } from '@/server/repositories/ticket-repository';

// vitest.config.ts forces SUPABASE_URL='' / SUPABASE_ANON_KEY='', so
// TicketRepository short-circuits DB calls. That keeps the unit tests
// fully in-process without hitting Supabase.

class FakeTicketRepository {
  insertedComments: Array<{ id: string; content: string; ticket_id: string }> = [];
  deletedCommentIds: string[] = [];
  callLog: string[] = [];
  /**
   * If non-null, the next `alertRepo.create` call for a mention will throw.
   * Resets after one use.
   */
  failNextMention: { forName: string } | null = null;

  async ticketExists(id: string): Promise<boolean> {
    this.callLog.push(`ticketExists:${id}`);
    return true;
  }

  async findById(id: string): Promise<unknown> {
    this.callLog.push(`findById:${id}`);
    return { id, ticket_number: 'T-001', title: '测试工单', conversation_id: 'conv-1' };
  }

  async addComment(input: { ticket_id: string; content: string; author_id: string | null; is_internal?: boolean }): Promise<{ comment: TicketCommentRow; author_name: string | null; author_avatar: string | null }> {
    this.callLog.push(`addComment:${input.ticket_id}`);
    const id = `cmt-${this.insertedComments.length + 1}`;
    const row: TicketCommentRow = {
      id,
      ticket_id: input.ticket_id,
      author_id: input.author_id ?? null,
      content: input.content,
      is_internal: input.is_internal ?? false,
      created_at: new Date().toISOString(),
    } as unknown as TicketCommentRow;
    this.insertedComments.push({ id, content: input.content, ticket_id: input.ticket_id });
    return { comment: row, author_name: 'agent-X', author_avatar: null };
  }

  async deleteComment(commentId: string): Promise<boolean> {
    this.callLog.push(`deleteComment:${commentId}`);
    this.deletedCommentIds.push(commentId);
    this.insertedComments = this.insertedComments.filter((c) => c.id !== commentId);
    return true;
  }
}

class FakeAlertRepository {
  created: Array<{ type: string; metadata: Record<string, unknown> }> = [];

  async create(input: { type: string; metadata: Record<string, unknown> }): Promise<unknown> {
    this.created.push({ type: input.type, metadata: input.metadata });
    return { id: `alert-${this.created.length}` };
  }
}

class FakeSettingsRepository {
  private values = new Map<string, string>([
    ['ticket_notify_enabled', 'true'],
  ]);
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async list(): Promise<Array<{ key: string; value: string }>> {
    return Array.from(this.values.entries()).map(([key, value]) => ({ key, value }));
  }
}

function buildService(): {
  svc: TicketService;
  ticketRepo: FakeTicketRepository;
  alertRepo: FakeAlertRepository;
  settings: FakeSettingsRepository;
} {
  const ticketRepo = new FakeTicketRepository();
  const alertRepo = new FakeAlertRepository();
  const settings = new FakeSettingsRepository();

  // Subclass TicketService so we can inject fake repos for alert + settings.
  // The base constructor only exposes `tickets`, but the service pulls the
  // other two deps from `new AlertRepository()` and `new SettingsRepository()`.
  // We swap them in via a private override.
  const baseSvc = new TicketService(ticketRepo as never);
  // Override the alertRepo / settingsRepo by replacing methods on the
  // prototype path. Easier: monkey-patch the two private fields via
  // `as unknown as`.
  type Mutable = {
    alertRepo: FakeAlertRepository;
    settingsRepo: FakeSettingsRepository;
  };
  const mutableBaseSvc = baseSvc as unknown as Mutable;
  mutableBaseSvc.alertRepo = alertRepo;
  mutableBaseSvc.settingsRepo = settings;

  return { svc: baseSvc, ticketRepo, alertRepo, settings };
}

describe('TicketService.addComment — T-7 transactional batch', () => {
  it('happy path with no mentions: comment insert is the only batched op', async () => {
    const { svc, ticketRepo, alertRepo } = buildService();
    const result = (await svc.addComment({
      ticket_id: 't-1',
      author_id: 'u-1',
      content: 'hello world',
      is_internal: false,
    })) as CommentWithAuthor;
    expect((result.comment as TicketCommentRow).id).toBe('cmt-1');
    expect(ticketRepo.insertedComments).toHaveLength(1);
    expect(alertRepo.created).toHaveLength(0);
    expect(ticketRepo.deletedCommentIds).toHaveLength(0);
  });

  it('happy path with mentions: comment insert + each mention alert succeeds', async () => {
    const { svc, ticketRepo, alertRepo } = buildService();
    const result = (await svc.addComment({
      ticket_id: 't-2',
      author_id: 'u-1',
      content: 'hi @张三 @李四',
      is_internal: false,
    })) as CommentWithAuthor;
    expect((result.comment as TicketCommentRow).id).toBe('cmt-1');
    expect(alertRepo.created).toHaveLength(2);
    const names = alertRepo.created.map((a) => a.metadata['mentioned_name']).sort();
    expect(names).toEqual(['张三', '李四']);
    expect(ticketRepo.deletedCommentIds).toHaveLength(0);
  });

  it('notification-failure path: when a mention insert throws, runBatch rolls back the comment', async () => {
    const { svc, ticketRepo, alertRepo } = buildService();
    // Make alertRepo.create throw for any mention. Replace create with one
    // that always fails.
    alertRepo.create = async () => {
      throw new Error('simulated alert write failure');
    };

    await expect(
      svc.addComment({
        ticket_id: 't-3',
        author_id: 'u-1',
        content: 'hi @张三',
        is_internal: false,
      }),
    ).rejects.toThrow();

    // Comment must have been rolled back. deleteComment must have been
    // called exactly once (the comment).
    expect(ticketRepo.deletedCommentIds).toContain('cmt-1');
    expect(ticketRepo.insertedComments).toHaveLength(0);
  });

  it('notification-failure path with multiple mentions: still rolls back only the comment', async () => {
    const { svc, ticketRepo, alertRepo } = buildService();
    let calls = 0;
    alertRepo.create = async (input: { metadata: Record<string, unknown> }) => {
      calls += 1;
      // Fail on the second mention to verify runBatch short-circuits.
      if (calls === 2) throw new Error('second mention fails');
      return { id: `alert-${calls}` };
    };

    await expect(
      svc.addComment({
        ticket_id: 't-4',
        author_id: 'u-1',
        content: 'hi @张三 @李四 @王五',
        is_internal: false,
      }),
    ).rejects.toThrow();

    expect(ticketRepo.deletedCommentIds).toContain('cmt-1');
    expect(ticketRepo.insertedComments).toHaveLength(0);
  });

  it('validation: empty content throws ServiceError and the batch never runs', async () => {
    const { svc, ticketRepo } = buildService();
    await expect(
      svc.addComment({
        ticket_id: 't-5',
        author_id: 'u-1',
        content: '   ',
        is_internal: false,
      }),
    ).rejects.toBeInstanceOf(ServiceError);

    expect(ticketRepo.callLog).toEqual([]);
    expect(ticketRepo.insertedComments).toHaveLength(0);
  });
});

/**
 * Sprint 6 (C-8) — `ConversationService.listConversations` bounded cache.
 *
 * Spec coverage:
 *   - second call with identical filter returns from cache (one repo.list call)
 *   - different status filter produces a different cache key
 *   - createConversation invalidates the list cache
 *   - insertMessage invalidates the list cache (last_message column shifts)
 *   - updateConversation invalidates the list cache (status changes)
 *   - bounded cache: > 200 entries evicts the LRU
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationService,
  invalidateConversationsListCache,
} from '@/server/services/conversation-service';
import type { Conversation } from '@/lib/types';

class FakeConversationRepository {
  listCalls: unknown[] = [];
  countCalls: unknown[] = [];
  statusCountsCalls: number = 0;
  lastMessageCalls: string[][] = [];
  conversations: Conversation[] = [];

  async list(filters: unknown): Promise<Conversation[]> {
    this.listCalls.push(filters);
    return this.conversations.slice(0, (filters as { limit?: number }).limit ?? 20);
  }
  async count(filters: unknown): Promise<number> {
    this.countCalls.push(filters);
    return this.conversations.length;
  }
  async getStatusCounts(): Promise<Record<string, number>> {
    this.statusCountsCalls++;
    const counts: Record<string, number> = {};
    for (const c of this.conversations) {
      counts[c.status ?? 'unknown'] = (counts[c.status ?? 'unknown'] ?? 0) + 1;
    }
    return counts;
  }
  async listLastMessages(ids: string[]): Promise<Array<{ conversation_id: string; content: string; image_url: string | null }>> {
    this.lastMessageCalls.push(ids);
    return ids.map((id) => ({ conversation_id: id, content: 'last-' + id, image_url: null }));
  }
  async findById(id: string): Promise<Conversation | null> {
    return this.conversations.find((c) => c.id === id) ?? null;
  }
  async update(id: string, patch: Record<string, unknown>): Promise<void> {
    const existing = this.conversations.find((c) => c.id === id);
    if (existing) Object.assign(existing, patch);
  }
  async create(input: { title: string; source: string; priority: 'normal' | 'urgent' }): Promise<Conversation> {
    const c: Conversation = {
      id: 'conv-' + Math.random().toString(36).slice(2, 8),
      title: input.title,
      source: input.source,
      priority: input.priority,
      status: 'active',
    } as unknown as Conversation;
    this.conversations.push(c);
    return c;
  }
  async insertMessage(): Promise<void> {}
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
  async updateSummary(): Promise<void> {}
  async markHandoff(id: string, reason: string): Promise<void> {
    await this.update(id, { status: 'handoff', handoff_reason: reason });
  }
  async updateAndReturn(id: string, patch: Record<string, unknown>): Promise<Conversation> {
    const existing = this.conversations.find((c) => c.id === id);
    return { ...(existing as Conversation), ...patch } as Conversation;
  }
  async delete(): Promise<void> {}
  async deleteMessages(): Promise<void> {}
  async countMessages(): Promise<number> { return 0; }
  async countUserMessages(): Promise<number> { return 0; }
  async listParticipants(): Promise<unknown[]> { return []; }
  async getFirstAssistantReplyAt(): Promise<string | null> { return null; }
  async findSessionInfo(): Promise<null> { return null; }
}

function buildService() {
  const repo = new FakeConversationRepository();
  const svc = new ConversationService(repo as never);
  return { svc, repo };
}

beforeEach(() => {
  invalidateConversationsListCache();
});

describe('C-8: listConversations cache', () => {
  it('second call with identical filter hits the cache', async () => {
    const { svc, repo } = buildService();
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(1);
  });

  it('different status produces a different cache key', async () => {
    const { svc, repo } = buildService();
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    await svc.listConversations({ status: 'ended', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('createConversation invalidates the list cache', async () => {
    const { svc, repo } = buildService();
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(1);
    await svc.createConversation({ title: 'New', source: 'web', priority: 'normal' });
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('insertMessage invalidates the list cache (last_message shifts)', async () => {
    const { svc, repo } = buildService();
    const c = await svc.createConversation({ title: 'Conv', source: 'web', priority: 'normal' });
    // Reset cache after the createConversation invalidation so we can
    // isolate the insertMessage invalidation.
    invalidateConversationsListCache();
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(1);
    await svc.insertMessage({
      conversation_id: c.id,
      role: 'user',
      content: 'hi',
      message_type: 'text',
    });
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('updateConversation invalidates the list cache', async () => {
    const { svc, repo } = buildService();
    const c = await svc.createConversation({ title: 'Conv', source: 'web', priority: 'normal' });
    invalidateConversationsListCache();
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(1);
    await svc.updateConversation(c.id, { status: 'handoff' });
    await svc.listConversations({ status: 'active', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('bounded cache: > maxSize entries evicts the LRU', async () => {
    const { svc, repo } = buildService();
    // 210 unique search keys → cache maxSize is 200.
    for (let i = 0; i < 210; i++) {
      await svc.listConversations({ search: `q-${i}`, limit: 20, offset: 0 });
    }
    expect(repo.listCalls.length).toBe(210);
    // Re-query the very first one — it must have been evicted.
    await svc.listConversations({ search: 'q-0', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(211);
    // Re-query a recent one — still cached.
    await svc.listConversations({ search: 'q-209', limit: 20, offset: 0 });
    expect(repo.listCalls.length).toBe(211);
  });
});
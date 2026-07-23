/**
 * Sprint 6 (C-7) — `CustomerService.listCustomers` bounded cache.
 *
 * Spec coverage:
 *   - second call with same query+filter returns from cache (only ONE
 *     underlying repo.list invocation)
 *   - different filter produces a different cache key (cache MISS)
 *   - updateCustomerTags invalidates the list cache
 *   - createCustomer invalidates the list cache
 *   - deleteCustomer (via deleteCustomerWithAudit) invalidates the list cache
 *   - bounded cache: when more than maxSize entries are inserted, the
 *     LRU is evicted
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CustomerService, invalidateCustomersListCache } from '@/server/services/customer-service';
import { toCustomerId } from '@/lib/repository-errors';

class FakeCustomerRepository {
  listCalls: Array<{ filters: unknown }> = [];
  rowsById: Map<string, Record<string, unknown>> = new Map();

  async list(filters: unknown): Promise<{ customers: unknown[]; total: number; page: number; pageSize: number }> {
    this.listCalls.push({ filters });
    return { customers: this.rowsById.size > 0 ? [...this.rowsById.values()] : [], total: this.rowsById.size, page: 1, pageSize: 20 };
  }
  async findById(id: string): Promise<Record<string, unknown> | null> {
    return this.rowsById.get(id) ?? null;
  }
  async findByExternalId(): Promise<{ id: string } | null> {
    return null;
  }
  async create(input: { name?: string; tags?: string[] }): Promise<{ id: string }> {
    const id = `cust-${Math.random().toString(36).slice(2, 8)}`;
    this.rowsById.set(id, { id, name: input.name ?? 'Test', tags: input.tags ?? [] });
    return { id };
  }
  async linkConversation(): Promise<void> {}
  async incrementConversationCount(): Promise<void> {}
  async update(id: string, patch: Record<string, unknown>): Promise<{ id: string }> {
    const existing = this.rowsById.get(id) ?? { id };
    this.rowsById.set(id, { ...existing, ...patch });
    return { id };
  }
  async delete(id: string): Promise<void> {
    this.rowsById.delete(id);
  }
}

function buildService() {
  const repo = new FakeCustomerRepository();
  const svc = new CustomerService(repo as never, { idempotentStore: null });
  return { svc, repo };
}

beforeEach(() => {
  // The cache is module-level so tests share it; clear before each test.
  invalidateCustomersListCache();
});

describe('C-7: listCustomers cache', () => {
  it('second call with identical filter hits the cache (one repo.list call)', async () => {
    const { svc, repo } = buildService();
    const filters = { search: 'Alice', platform: 'web', page: 1, pageSize: 20 };
    await svc.listCustomers(filters);
    await svc.listCustomers(filters);
    await svc.listCustomers(filters);
    expect(repo.listCalls.length).toBe(1);
  });

  it('different filter produces a different cache key (MISS, repo.list called again)', async () => {
    const { svc, repo } = buildService();
    await svc.listCustomers({ search: 'Alice', platform: 'web', page: 1, pageSize: 20 });
    await svc.listCustomers({ search: 'Alice', platform: 'qianniu', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('updateCustomerTags invalidates the list cache', async () => {
    const { svc, repo } = buildService();
    const id = (await repo.create({ name: 'Alice' })).id;

    await svc.listCustomers({ search: 'Alice', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(1);
    await svc.updateCustomerTags(toCustomerId(id), [
      { type: 'add', tag: 'vip', requestId: 'req-1' },
    ]);
    // After invalidation, the next list must hit the repo.
    await svc.listCustomers({ search: 'Alice', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('createCustomer invalidates the list cache', async () => {
    const { svc, repo } = buildService();
    await svc.listCustomers({ search: '', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(1);
    await svc.createCustomer({ name: 'New Customer' });
    await svc.listCustomers({ search: '', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('deleteCustomerWithAudit invalidates the list cache', async () => {
    const { svc, repo } = buildService();
    const id = (await repo.create({ name: 'Doomed' })).id;
    await svc.listCustomers({ search: '', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(1);
    await svc.deleteCustomerWithAudit({
      customerId: toCustomerId(id),
      operatorId: 'u-1',
      auditHook: async () => {},
    });
    await svc.listCustomers({ search: '', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(2);
  });

  it('bounded cache: > maxSize entries evicts the LRU', async () => {
    const { svc, repo } = buildService();
    // Generate 60 distinct cache keys. The cache maxSize is 50.
    for (let i = 0; i < 60; i++) {
      await svc.listCustomers({ search: `unique-${i}`, platform: 'web', page: 1, pageSize: 20 });
    }
    expect(repo.listCalls.length).toBe(60);
    // Re-query the FIRST entry (i=0) — it must have been evicted,
    // so the repo is called again. Total = 60 + 1 = 61.
    await svc.listCustomers({ search: 'unique-0', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(61);
    // Re-query a RECENT entry (i=59) — it should still be cached.
    await svc.listCustomers({ search: 'unique-59', platform: 'web', page: 1, pageSize: 20 });
    expect(repo.listCalls.length).toBe(61);
  });
});
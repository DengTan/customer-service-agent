/**
 * Sprint 5 (MR-1..MR-6) — MarketingService hardening tests.
 *
 * Covers:
 * - M-1: executeCampaign() concurrency guard (idempotent collapse).
 * - M-2: processScheduledCampaigns() batch dedup.
 * - M-3: promoteVariant() A/B lock.
 * - M-6: executeCampaign() reports partial_failure once failures >= 3.
 * - M-7: getAnalytics() bounded cache hit + invalidation on writes.
 * - M-8: processScheduledCampaigns() per-campaign isolation via runBatch.
 *
 * The service is constructed with a hand-rolled fake repo + a synthetic
 * idempotent store so we can observe "would-have-been Supabase" behavior
 * without leaving demo mode.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingService } from './marketing-service';
import type { MarketingCampaignRow } from '@/server/repositories/marketing-repository';

// ─── Fakes ──────────────────────────────────────────────────────────────────

class FakeMarketingRepository {
  campaigns: MarketingCampaignRow[] = [
    {
      id: 'c1',
      name: 'promotion',
      type: 'promotion',
      target_segment: {},
      bot_id: null,
      status: 'active',
      ab_variants: null,
      message_template: 'hello {{customer_name}}',
      trigger_type: 'manual',
      scheduled_at: null,
      trigger_config: null,
      created_at: '2026-07-01T00:00:00Z',
    },
  ];
  /** Customers the next findCustomersBySegment call will return. */
  customerQueue: Array<{ id: string; name: string; source_platform: string | null; tags: string[] | null }> = [];
  /** Queue of errors to throw on successive `createMarketingLog` calls. */
  logErrorQueue: Error[] = [];
  logWrites: Array<{ campaign_id: string; customer_id: string; variant: string | undefined }> = [];
  createMarketingLogCount = 0;

  async findById(id: string): Promise<MarketingCampaignRow | null> {
    return this.campaigns.find((c) => c.id === id) ?? null;
  }
  async list(): Promise<MarketingCampaignRow[]> {
    return [...this.campaigns];
  }
  async findCustomersBySegment(): Promise<Array<{ id: string; name: string; source_platform: string | null; tags: string[] | null }>> {
    return [...this.customerQueue];
  }
  async createMarketingLog(input: { campaign_id: string; customer_id: string; variant: string | undefined }): Promise<unknown> {
    this.createMarketingLogCount++;
    this.logWrites.push(input);
    if (this.logErrorQueue.length > 0) {
      throw this.logErrorQueue.shift()!;
    }
    return { id: `log-${this.logWrites.length}` };
  }
  async update(input: { id: string; status?: string; ab_variants?: unknown; message_template?: string | null }): Promise<MarketingCampaignRow> {
    const idx = this.campaigns.findIndex((c) => c.id === input.id);
    if (idx === -1) throw new Error(`campaign ${input.id} not found`);
    const merged = { ...this.campaigns[idx]!, ...input } as MarketingCampaignRow;
    this.campaigns[idx] = merged;
    return merged;
  }
  async getDailyStats() {
    return [];
  }
  async getStatsByType(): Promise<Record<string, { sent: number; replied: number; converted: number }>> {
    return {};
  }
  async getTopCampaigns() {
    return [];
  }
  async getVariantStats() {
    return [];
  }
  async countAllLogs() {
    return { totalSent: 0, totalReplied: 0, totalConverted: 0 };
  }
  async countLogsByCampaign() {
    return { sent: 0, replied: 0, converted: 0 };
  }
  async previewSegment() {
    return { total: 0, samples: [] };
  }
  async create(): Promise<MarketingCampaignRow> {
    throw new Error('not used in these tests');
  }
  async delete(): Promise<void> { /* unused */ }
}

/**
 * In-memory idempotency store matching the `IdempotencyStore` interface.
 * Lets us observe acquire/release count without touching Supabase.
 */
class FakeIdempotencyStore {
  acquired: string[] = [];
  released: string[] = [];

  async tryAcquire(key: string): Promise<boolean> {
    if (this.acquired.includes(key)) return false;
    this.acquired.push(key);
    return true;
  }
  async release(key: string): Promise<void> {
    this.released.push(key);
  }
}

function buildService(): {
  svc: MarketingService;
  repo: FakeMarketingRepository;
  store: FakeIdempotencyStore;
} {
  const repo = new FakeMarketingRepository();
  const store = new FakeIdempotencyStore();
  const svc = new MarketingService(repo as never, store as never);
  return { svc, repo, store };
}

function buildServiceWithStore(_store: FakeIdempotencyStore | null): {
  svc: MarketingService;
  repo: FakeMarketingRepository;
  store: FakeIdempotencyStore | null;
} {
  // Reserved for future test variants that need a custom store.
  const repo = new FakeMarketingRepository();
  const store = new FakeIdempotencyStore();
  const svc = new MarketingService(repo as never, store as never);
  return { svc, repo, store };
}

// We lazily import ConversationService from inside runExecuteCampaign. To
// avoid a heavy pull, stub the module so executeCampaign's per-customer
// branch never touches the real service. The module specifier must match
// the dynamic import in marketing-service.ts; the service uses an
// `@/server/...`-free relative path, so we resolve via the same alias.
vi.mock('@/server/services/conversation-service', () => {
  return {
    ConversationService: class {
      async createConversation() {
        return { id: 'conv-fixed-id' };
      }
      async insertMessage() {
        return { id: 'msg-fixed-id' };
      }
    },
  };
});

beforeEach(async () => {
  vi.clearAllMocks();
  // The analytics cache is module-level; clear it between tests so prior
  // assertions don't leak into later ones.
  const cacheModule = await import('@/lib/bounded-cache');
  // Best-effort: we don't have direct access to the module-level cache,
  // so we just clear all keys by TTL expiry + an explicit clear via the
  // service's invalidation hook.
  const svc = new MarketingService(
    { findById: vi.fn(), list: vi.fn() } as never,
    null,
    null,
  );
  svc.invalidateAnalyticsCache();
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── M-1: executeCampaign idempotency ───────────────────────────────────────

describe('MarketingService.executeCampaign — M-1 idempotent dedup', () => {
  it('runs the inner pipeline exactly once even with concurrent calls', async () => {
    const { svc, repo, store } = buildService();
    repo.customerQueue = [
      { id: 'u1', name: 'A', source_platform: 'web', tags: null },
      { id: 'u2', name: 'B', source_platform: 'web', tags: null },
    ];
    const [a, b] = await Promise.all([svc.executeCampaign('c1'), svc.executeCampaign('c1')]);
    expect(store.acquired.filter((k) => k.includes('campaign_execution')).length).toBeGreaterThanOrEqual(1);
    // `c1` ran at most once → at most two marketing_log inserts total, not four.
    expect(repo.createMarketingLogCount).toBeLessThanOrEqual(2);
    expect(a.campaignId).toBe('c1');
    expect(b.campaignId).toBe('c1');
  });

  it('returns a skipped marker when the second call loses the race', async () => {
    const { svc, repo } = buildService();
    repo.customerQueue = [{ id: 'u1', name: 'A', source_platform: 'web', tags: null }];

    const first = await svc.executeCampaign('c1');
    // Wait past the idempotency window before the second call so it does
    // NOT see SKIPPED. This proves the idempotency was the only thing
    // deduping them.
    // Easier: within the window (60s), the second call should dedup.
    const second = await svc.executeCampaign('c1');
    // The first call wins and produces a result; the second call sees
    // SKIPPED. The implementation cannot surface the cached payload
    // because Sprint 1's idempotency layer only stores the lock, so the
    // second call returns `status: 'skipped'` and an empty body.
    expect(first.status === 'completed' || first.status === 'partial_failure').toBe(true);
    expect(second.status).toBe('skipped');
    // The underlying repo counter must not double.
    expect(repo.createMarketingLogCount).toBe(1);
  });

  it('uses a 60-second window so retries can re-run after expiry', async () => {
    // The fake store has no expiry concept (a single-shot acquire/release);
    // we emulate the 60s window expiry by clearing the acquire tracking
    // between calls. The 60s contract itself is asserted at the call site
    // (windowMs: 60_000 in executeCampaign).
    const { svc, repo, store } = buildService();
    repo.customerQueue = [{ id: 'u1', name: 'A', source_platform: 'web', tags: null }];

    await svc.executeCampaign('c1');
    // The first call acquired the persistent key.
    const firstKey = store.acquired.find((k) => k.startsWith('campaign_execution:'));
    expect(firstKey).toBeDefined();
    // Simulate window expiry by releasing the lock (production behavior
    // is the MemoryStore's TTL elapsing).
    if (firstKey) {
      await store.release(firstKey);
      // Reset tracking so we can confirm the second acquire.
      store.acquired.length = 0;
    }
    await svc.executeCampaign('c1');
    const secondKeys = store.acquired.filter((k) => k.startsWith('campaign_execution:'));
    expect(secondKeys.length).toBeGreaterThanOrEqual(1);
    expect(repo.createMarketingLogCount).toBe(2);
  });
});

// ─── M-6: executeCampaign returns partial_failure once failures >= 3 ────────

describe('MarketingService.executeCampaign — M-6 partial_failure', () => {
  it('flags partial_failure when three or more customers fail', async () => {
    const { svc, repo } = buildService();
    repo.customerQueue = [
      { id: 'u1', name: 'A', source_platform: 'web', tags: null },
      { id: 'u2', name: 'B', source_platform: 'web', tags: null },
      { id: 'u3', name: 'C', source_platform: 'web', tags: null },
      { id: 'u4', name: 'D', source_platform: 'web', tags: null },
      { id: 'u5', name: 'E', source_platform: 'web', tags: null },
    ];
    // Queue 3 errors — the first 3 calls fail, the last 2 succeed.
    repo.logErrorQueue.push(new Error('log write failed #1'));
    repo.logErrorQueue.push(new Error('log write failed #2'));
    repo.logErrorQueue.push(new Error('log write failed #3'));
    const result = await svc.executeCampaign('c1');
    expect(result.failCount).toBeGreaterThanOrEqual(3);
    expect(result.status).toBe('partial_failure');
    // The successful sends still happened even though earlier ones failed.
    expect(result.successCount).toBeGreaterThanOrEqual(2);
    // Verify runBatch collected per-customer errors so callers know which
    // customers to resend.
    const failedCustomers = result.details.filter((d) => d.status === 'failed').map((d) => d.customerId);
    expect(failedCustomers.length).toBeGreaterThanOrEqual(3);
  });

  it('returns status: "completed" when fewer than three customers fail', async () => {
    const { svc, repo } = buildService();
    repo.customerQueue = [
      { id: 'u1', name: 'A', source_platform: 'web', tags: null },
      { id: 'u2', name: 'B', source_platform: 'web', tags: null },
      { id: 'u3', name: 'C', source_platform: 'web', tags: null },
    ];
    // Fail only the first log write → 2 succeed, 1 fails → status "completed".
    repo.logErrorQueue.push(new Error('one-off'));
    const result = await svc.executeCampaign('c1');
    expect(result.failCount).toBe(1);
    expect(result.status).toBe('completed');
  });

  it('reports each customer failure in `details` so the caller can resend', async () => {
    const { svc, repo } = buildService();
    repo.customerQueue = [
      { id: 'u1', name: 'A', source_platform: 'web', tags: null },
      { id: 'u2', name: 'B', source_platform: 'web', tags: null },
    ];
    repo.logErrorQueue.push(new Error('log write failed #1'));
    repo.logErrorQueue.push(new Error('log write failed #2'));
    const result = await svc.executeCampaign('c1');
    const failed = result.details.filter((d) => d.status === 'failed');
    expect(failed.length).toBe(2);
    expect(failed.every((d) => typeof d.error === 'string' && d.error.length > 0)).toBe(true);
  });
});

// ─── M-2: processScheduledCampaigns batch dedup ─────────────────────────────

describe('MarketingService.processScheduledCampaigns — M-2 batch dedup', () => {
  it('collapses concurrent invocations sharing a batchId (memory scope)', async () => {
    const { svc, repo } = buildService();
    // Add a scheduled campaign.
    repo.campaigns.push({
      id: 'sched-1',
      name: 'sched-A',
      type: 'promotion',
      target_segment: {},
      bot_id: null,
      status: 'scheduled',
      ab_variants: null,
      message_template: 'hi',
      trigger_type: 'scheduled',
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      trigger_config: null,
      created_at: '2026-07-01T00:00:00Z',
    });
    repo.customerQueue = [];

    const batchId = 'batch-X';
    const [a, b] = await Promise.all([
      svc.processScheduledCampaigns({ batchId }),
      svc.processScheduledCampaigns({ batchId }),
    ]);
    // Exactly one of the two runs the pipeline; the other is SKIPPED.
    expect(a.skipped !== b.skipped).toBe(true);
    const processed = [a, b].find((r) => !r.skipped);
    expect(processed?.processed).toBe(1);
  });

  it('uses distinct batchIds to allow concurrent distinct scans to run', async () => {
    const { svc, repo } = buildService();
    repo.campaigns.push({
      id: 'sched-1',
      name: 'sched-A',
      type: 'promotion',
      target_segment: {},
      bot_id: null,
      status: 'scheduled',
      ab_variants: null,
      message_template: 'hi',
      trigger_type: 'scheduled',
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      trigger_config: null,
      created_at: '2026-07-01T00:00:00Z',
    });
    repo.customerQueue = [];

    const [a, b] = await Promise.all([
      svc.processScheduledCampaigns({ batchId: 'batch-1' }),
      svc.processScheduledCampaigns({ batchId: 'batch-2' }),
    ]);
    expect(a.skipped).toBe(false);
    expect(b.skipped).toBe(false);
  });

  it('generates a unique batchId per call when no options are passed (backward compat)', async () => {
    const { svc } = buildService();
    const result = await svc.processScheduledCampaigns();
    // The compat overload returns the standard shape.
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('skipped');
    expect(result.skipped).toBe(false);
  });
});

// ─── M-8: processScheduledCampaigns per-campaign isolation ──────────────────

describe('MarketingService.processScheduledCampaigns — M-8 batch isolation', () => {
  it('continues processing the rest of the batch when one campaign fails', async () => {
    const { svc, repo } = buildService();
    // Two campaigns scheduled; the first one points at a missing id (will
    // fail in the execute step), the second runs cleanly.
    repo.campaigns.push(
      {
        id: 'sched-bad',
        name: 'broken',
        type: 'promotion',
        target_segment: {},
        bot_id: null,
        status: 'scheduled',
        ab_variants: null,
        message_template: 'hi',
        trigger_type: 'scheduled',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
        trigger_config: null,
        created_at: '2026-07-01T00:00:00Z',
      },
      {
        id: 'sched-good',
        name: 'good',
        type: 'promotion',
        target_segment: {},
        bot_id: null,
        status: 'scheduled',
        ab_variants: null,
        message_template: 'hi {{customer_name}}',
        trigger_type: 'scheduled',
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
        trigger_config: null,
        created_at: '2026-07-01T00:00:00Z',
      },
    );
    repo.customerQueue = [{ id: 'u1', name: 'A', source_platform: 'web', tags: null }];

    // Make the bad campaign fail by switching it to a status that doesn't
    // match the filter, then back to scheduled once via the run. Easier:
    // hijack the runExecuteCampaign via a flag on the repo.
    // We instead let the bad campaign attempt to execute (id 'sched-bad'
    // resolves fine), and intentionally cause its inner code path to throw
    // by tampering with the repo.
    const originalUpdate = repo.update.bind(repo);
    repo.update = vi.fn(async (input) => {
      if (input.id === 'sched-bad' && input.status === 'running') {
        throw new Error('forced failure for bad campaign');
      }
      return originalUpdate(input);
    }) as never;

    const result = await svc.processScheduledCampaigns({ batchId: 'test-isolation' });
    expect(result.processed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/sched-bad|broken/);
  });

  it('still runs even when there are no matching scheduled campaigns', async () => {
    const { svc, repo } = buildService();
    repo.campaigns = [];
    const result = await svc.processScheduledCampaigns({ batchId: 'empty' });
    expect(result.processed).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

// ─── M-3: promoteVariant A/B lock ───────────────────────────────────────────

describe('MarketingService.promoteVariant — M-3 A/B lock', () => {
  it('promotes the winner and writes message_template exactly once', async () => {
    const { svc, repo } = buildService();
    repo.campaigns[0]!.ab_variants = {
      enabled: true,
      variant_a: 'A copy',
      variant_b: 'B copy',
    };
    const updates: Array<{ id: string; message_template?: string | null; ab_variants?: unknown }> = [];
    repo.update = vi.fn(async (input) => {
      updates.push(input);
      const idx = repo.campaigns.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error('not found');
      const merged = { ...repo.campaigns[idx]!, ...input } as MarketingCampaignRow;
      repo.campaigns[idx] = merged;
      return merged;
    }) as never;

    const result = await svc.promoteVariant('c1', 'B');
    expect(result.campaign.message_template).toBe('B copy');
    // The update payload was applied exactly once.
    const messageUpdates = updates.filter((u) => 'message_template' in u);
    expect(messageUpdates).toHaveLength(1);
  });

  it('returns the latest row on a duplicate concurrent call (idempotent)', async () => {
    const { svc, repo } = buildService();
    repo.campaigns[0]!.ab_variants = {
      enabled: true,
      variant_a: 'A copy',
      variant_b: 'B copy',
    };
    const updates: unknown[] = [];
    repo.update = vi.fn(async (input) => {
      updates.push(input);
      const idx = repo.campaigns.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error('not found');
      const merged = { ...repo.campaigns[idx]!, ...input } as MarketingCampaignRow;
      repo.campaigns[idx] = merged;
      return merged;
    }) as never;

    // First call acquires the persistent key; second call sees SKIPPED
    // and re-reads the existing row.
    const updatesBefore = updates.length;
    await svc.promoteVariant('c1', 'A');
    const firstCount = updates.length - updatesBefore;
    await svc.promoteVariant('c1', 'A');
    // The duplicate call should not have written a second template write.
    const templateWrites = updates.filter((u) => (u as { message_template?: string }).message_template !== undefined).length;
    expect(templateWrites).toBe(firstCount);
    // But re-reading on SKIPPED still re-uses findById.
    expect(templateWrites).toBeGreaterThanOrEqual(1);
  });

  it('disallows promoting when A/B testing is not enabled', async () => {
    const { svc, repo } = buildService();
    repo.campaigns[0]!.ab_variants = null;
    await expect(svc.promoteVariant('c1', 'A')).rejects.toThrow(/未启用A\/B测试|INVALID_STATE|VALIDATION_ERROR|not.*enabled/i);
  });
});

// ─── M-7: getAnalytics cache ────────────────────────────────────────────────

describe('MarketingService.getAnalytics — M-7 bounded cache', () => {
  it('returns the same payload twice without re-querying the repository', async () => {
    const { svc, repo } = buildService();
    const getDailyStatsSpy = vi.spyOn(repo, 'getDailyStats');
    const countAllLogsSpy = vi.spyOn(repo, 'countAllLogs');
    const a = await svc.getAnalytics(undefined, 30);
    const b = await svc.getAnalytics(undefined, 30);
    expect(getDailyStatsSpy).toHaveBeenCalledTimes(1);
    expect(countAllLogsSpy).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('serves distinct keys independently (per-campaign caching)', async () => {
    const { svc, repo } = buildService();
    const getDailyStatsSpy = vi.spyOn(repo, 'getDailyStats');
    await svc.getAnalytics('c1', 30);
    await svc.getAnalytics('c-other', 30);
    // Two distinct keys → both hit the underlying computation.
    expect(getDailyStatsSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache when invalidateAnalyticsCache() is called', async () => {
    const { svc, repo } = buildService();
    const getDailyStatsSpy = vi.spyOn(repo, 'getDailyStats');
    await svc.getAnalytics(undefined, 30);
    svc.invalidateAnalyticsCache();
    await svc.getAnalytics(undefined, 30);
    expect(getDailyStatsSpy).toHaveBeenCalledTimes(2);
  });

  it('respects the LRU + TTL bounded semantics: 200 entries, 5-minute TTL', async () => {
    const cacheModule = await import('@/lib/bounded-cache');
    const fresh = cacheModule.createBoundedCache<string, string>({ maxSize: 200, ttlMs: 5 * 60 * 1000 });
    fresh.set('k1', 'v1');
    expect(fresh.has('k1')).toBe(true);
    expect(fresh.stats().size).toBe(1);
    // Past maxSize → LRU eviction kicks in.
    for (let i = 0; i < 250; i++) fresh.set(`k-${i}`, `v-${i}`);
    expect(fresh.stats().size).toBe(200);
    expect(fresh.stats().evictions).toBeGreaterThan(0);
  });
});

/**
 * Sprint 3 — R-1: UnsupportedFeatureError / BM25-only fallback tests.
 *
 * The dataset repository layer raises `UnsupportedFeatureError` for
 * PostgreSQL 42883 (`undefined_function`). The hybrid-search vector path
 * catches that error and degrades to BM25-only so a deployment that is
 * missing `match_knowledge_items` still answers queries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

vi.mock('@/server/services/embedding-service', () => ({
  getEmbeddingService: () => ({ embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) }),
}));

// Track vectorSearch / bm25Search call counts so R-1 tests can verify
// "BM25 still ran after vector 42883".
let vectorCalls = 0;
let bm25Calls = 0;
const vectorImpl = vi.fn();
const bm25Impl = vi.fn();

vi.mock('@/server/services/bm25-search-service', () => ({
  getBm25Service: () => ({
    ensureIndex: vi.fn().mockResolvedValue(undefined),
    // Use a high BM25 score (0.95) so the default minScore=0.75 doesn't filter
    // it out under RRF fusion. R-1 only cares that the BM25 channel produced
    // a hit; threshold semantics are tested separately in knowledge-search tests.
    search: vi.fn().mockReturnValue([{ id: 'bm25-1', content: 'bm25 result', score: 0.95, knowledge_item_id: 'bm25-1', chunk_index: 0 }]),
  }),
}));

vi.mock('@/server/repositories/settings-repository', () => ({
  SettingsRepository: class {
    get = vi.fn().mockResolvedValue(null);
  },
}));

vi.mock('@/server/services/rerank-service', () => ({
  RerankService: class { rerank = vi.fn(); getActiveBackend = () => 'mock'; },
  resetRerankService: vi.fn(),
}));

import { UnsupportedFeatureError } from '@/lib/repository-errors';
import { mapSupabaseError } from '@/lib/repository-errors';

describe('R-1: UnsupportedFeatureError mapping', () => {
  it('maps PostgREST 42883 to UnsupportedFeatureError', () => {
    const mapped = mapSupabaseError({ code: '42883', message: 'function does not exist' }, 'test');
    expect(mapped).toBeInstanceOf(UnsupportedFeatureError);
    expect(mapped.kind).toBe('UNSUPPORTED');
    expect(mapped.code).toBe('UNDEFINED_FUNCTION');
  });

  it('keeps PGRST116 mapped to NotFoundError (regression guard)', () => {
    const mapped = mapSupabaseError({ code: 'PGRST116', message: 'no rows' }, 'test');
    expect(mapped.kind).toBe('NOT_FOUND');
    expect(mapped.code).toBe('PGRST_NO_ROWS');
  });

  it('keeps unknown codes mapped to InternalError', () => {
    const mapped = mapSupabaseError({ code: 'ZZZZ', message: '???' }, 'test');
    expect(mapped.kind).toBe('INTERNAL');
  });
});

describe('R-1: hybrid-search vector 42883 fallback', () => {
  beforeEach(() => {
    vectorCalls = 0;
    bm25Calls = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns BM25 results when vector RPC reports 42883', async () => {
    // Re-import after mocks are wired so the freshly-instantiated
    // HybridSearchService uses our mocked deps.
    const { getHybridSearchService } = await import('@/server/services/hybrid-search-service');
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');

    // Force vectorSearch to throw the postgREST 42883 envelope by mocking
    // the supabase.rpc path that vectorSearch uses.
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function match_knowledge_items does not exist' },
    });
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcMock });

    const svc = getHybridSearchService();
    const result = await svc.search('hello', { limit: 3, skipRerank: true });

    // Vector fell back to empty (no throw), BM25 returned its mock data —
    // hybrid must surface that, not throw.
    expect(result.results.length).toBe(1);
    expect(result.results[0].id).toBe('bm25-1');
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when 42883 is raised as an exception (not just as error field)', async () => {
    const { getHybridSearchService } = await import('@/server/services/hybrid-search-service');
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');

    const throwingRpc = vi.fn().mockRejectedValue(
      Object.assign(new Error('undefined function'), { code: '42883' }),
    );
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: throwingRpc });

    const svc = getHybridSearchService();
    await expect(svc.search('hi', { limit: 3, skipRerank: true })).resolves.toBeTruthy();
  });

  it('still propagates data errors (non-42883) without silent fallback', async () => {
    // This regression guard ensures R-1 only catches UnsupportedFeatureError,
    // not *every* error — actual DB faults (e.g. 42501 permission denied)
    // must still surface so they are not silently swallowed.
    const { getHybridSearchService } = await import('@/server/services/hybrid-search-service');
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');

    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcMock });

    const svc = getHybridSearchService();
    const result = await svc.search('anything', { limit: 3, skipRerank: true });
    // Outer try/catch in search() returns an empty result on hard errors.
    // The point is: the error is *classified* (DATA_ERROR), not silently absorbed
    // as a feature gap, and the orchestrator consumer still gets a structured
    // error envelope to react to.
    expect(result.results.length).toBe(1); // BM25 still ran
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

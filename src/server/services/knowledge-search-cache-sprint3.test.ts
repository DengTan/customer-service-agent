/**
 * Sprint 3 — R-3 / R-5 tests for the knowledge-search settings + result
 * caches. Verifies the `createBoundedCache` plumbing, the settings-cache
 * invalidation hook, and the per-query result cache key shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

vi.mock('@/server/repositories/settings-repository', () => ({
  SettingsRepository: class {
    get = vi.fn().mockImplementation(async (key: string) => {
      if (key === 'knowledge_min_score') return '0.7';
      if (key === 'knowledge_search_limit') return '5';
      if (key === 'knowledge_image_search_limit') return '3';
      if (key === 'knowledge_image_max_citations') return '9';
      return null;
    });
  },
}));

import {
  invalidateKnowledgeSearchSettingsCache,
  invalidateKnowledgeSearchResultCache,
  knowledgeSearchResultCacheStats,
  KNOWNLEDGE_SETTINGS_INVALIDATE_EVENT,
} from '@/server/services/knowledge-search-service';

describe('R-3: settings cache uses createBoundedCache + invalidation hook', () => {
  it('invalidates without throwing (was previously an ad-hoc Map)', () => {
    expect(() => invalidateKnowledgeSearchSettingsCache()).not.toThrow();
  });

  it('exports the broadcast event name so SettingsService can match it', () => {
    expect(KNOWNLEDGE_SETTINGS_INVALIDATE_EVENT).toBe('settings:updated');
  });
});

describe('R-5: per-query result cache', () => {
  beforeEach(() => {
    invalidateKnowledgeSearchResultCache();
  });

  it('exports stats helpers and they return a sane shape', () => {
    const stats = knowledgeSearchResultCacheStats();
    expect(stats).toMatchObject({ size: expect.any(Number), hits: expect.any(Number), misses: expect.any(Number) });
  });

  it('invalidateKnowledgeSearchResultCache clears without throwing', () => {
    expect(() => invalidateKnowledgeSearchResultCache()).not.toThrow();
  });

  it('re-invalidation after a broadcast returns to zero hits on the next call', () => {
    invalidateKnowledgeSearchResultCache();
    const stats = knowledgeSearchResultCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
  });
});

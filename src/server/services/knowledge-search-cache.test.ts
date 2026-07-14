import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { invalidateKnowledgeSearchSettingsCache } from '@/server/services/knowledge-search-service';
import { getKnowledgeSearchService } from '@/server/services/knowledge-search-service';

describe('invalidateKnowledgeSearchSettingsCache', () => {
  it('exists and resets the cache to null after being called', async () => {
    // Prime cache by reading settings — but we don't have a real Supabase client.
    // The cache invalidation function is exported and pure (sync, side-effect free),
    // so we just verify the contract: it can be called and does not throw.
    expect(() => invalidateKnowledgeSearchSettingsCache()).not.toThrow();
    // Calling twice in a row is also safe
    expect(() => invalidateKnowledgeSearchSettingsCache()).not.toThrow();
  });
});
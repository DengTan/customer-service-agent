import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { ContentFilterService } from '@/server/services/content-filter-service';

describe('ContentFilterService.clearCache', () => {
  it('exists and can be called without throwing', async () => {
    const service = new ContentFilterService();
    expect(() => service.clearCache()).not.toThrow();
  });
});
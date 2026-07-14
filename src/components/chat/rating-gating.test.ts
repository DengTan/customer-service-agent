import { describe, expect, it, vi } from 'vitest';

import {
  shouldShowRatingCard,
  processRatingSubmit,
} from './rating-gating';

describe('shouldShowRatingCard', () => {
  it('returns false when rating capability is disabled', () => {
    expect(shouldShowRatingCard({
      conversationStatus: 'ended',
      hasRating: false,
      ratingEnabled: false,
    })).toBe(false);
  });

  it('returns false when conversation has not ended', () => {
    expect(shouldShowRatingCard({
      conversationStatus: 'active',
      hasRating: false,
      ratingEnabled: true,
    })).toBe(false);
  });

  it('returns false when conversation already has a rating', () => {
    expect(shouldShowRatingCard({
      conversationStatus: 'ended',
      hasRating: true,
      ratingEnabled: true,
    })).toBe(false);
  });

  it('returns true when ended + not yet rated + capability enabled', () => {
    expect(shouldShowRatingCard({
      conversationStatus: 'ended',
      hasRating: false,
      ratingEnabled: true,
    })).toBe(true);
  });

  it('returns false when status is handoff (rating only after ended)', () => {
    expect(shouldShowRatingCard({
      conversationStatus: 'handoff',
      hasRating: false,
      ratingEnabled: true,
    })).toBe(false);
  });
});

describe('processRatingSubmit', () => {
  it('reports success when response is ok', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const result = await processRatingSubmit({
      conversationId: 'conv-1',
      rating: 5,
      comment: 'great',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });
  });

  it('reports RATING_DISABLED on 403 + RATING_DISABLED code', async () => {
    const body = JSON.stringify({ error: '评价功能已关闭', code: 'RATING_DISABLED' });
    const fetchImpl = vi.fn(async () =>
      new Response(body, { status: 403, headers: { 'Content-Type': 'application/json' } }),
    );
    const result = await processRatingSubmit({
      conversationId: 'conv-1',
      rating: 4,
      comment: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RATING_DISABLED');
    }
  });

  it('reports RETRY on 4xx/5xx without RATING_DISABLED code', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }));
    const result = await processRatingSubmit({
      conversationId: 'conv-1',
      rating: 3,
      comment: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RETRY');
    }
  });

  it('reports RETRY on network error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network'); });
    const result = await processRatingSubmit({
      conversationId: 'conv-1',
      rating: 5,
      comment: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RETRY');
    }
  });
});
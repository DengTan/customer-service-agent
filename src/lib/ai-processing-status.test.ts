import { describe, it, expect } from 'vitest';
import { resolveAiProcessingState, AI_PROCESSING_STALE_AFTER_MS } from './ai-processing-status';

describe('resolveAiProcessingState', () => {
  // Pinned reference time — 2026-07-17T10:00:00.000Z
  // Date.parse('2026-07-17T10:00:00.000Z') === 1784282400000
  const NOW = 1_784_282_400_000;
  const NOW_ISO = '2026-07-17T10:00:00.000Z';

  it('returns isProcessing=false when DB column is false', () => {
    const result = resolveAiProcessingState(false, null, NOW);
    expect(result).toEqual({ isProcessing: false, isStale: false, raw: false });
  });

  it('returns isProcessing=false and isStale=false when DB is false even if a stale timestamp exists', () => {
    // Defensive: DB ai_processing=false should always win, regardless of timestamp value.
    const tenMinutesAgo = new Date(NOW - AI_PROCESSING_STALE_AFTER_MS - 60_000).toISOString();
    const result = resolveAiProcessingState(false, tenMinutesAgo, NOW);
    expect(result).toEqual({ isProcessing: false, isStale: false, raw: false });
  });

  it('returns isProcessing=false when DB column is null/undefined', () => {
    expect(resolveAiProcessingState(null, null, NOW)).toEqual({
      isProcessing: false,
      isStale: false,
      raw: false,
    });
    expect(resolveAiProcessingState(undefined, null, NOW)).toEqual({
      isProcessing: false,
      isStale: false,
      raw: false,
    });
  });

  it('returns isProcessing=true when DB says true and timestamp is recent', () => {
    const threeSecondsAgo = new Date(NOW - 3_000).toISOString();
    const result = resolveAiProcessingState(true, threeSecondsAgo, NOW);
    expect(result.isProcessing).toBe(true);
    expect(result.isStale).toBe(false);
    expect(result.raw).toBe(true);
    expect(result.startedAt).toBe(threeSecondsAgo);
  });

  it('returns isProcessing=false and isStale=true when timestamp exceeds STALE_AFTER_MS', () => {
    // The bug-prevention core: a server crashed 10 minutes ago. DB still says processing=true.
    // The UI must NOT show "AI 正在回复" stuck — show idle instead.
    const tenMinutesAgo = new Date(NOW - AI_PROCESSING_STALE_AFTER_MS - 60_000).toISOString();
    const result = resolveAiProcessingState(true, tenMinutesAgo, NOW);
    expect(result.isProcessing).toBe(false);
    expect(result.isStale).toBe(true);
    expect(result.raw).toBe(true);
  });

  it('returns isProcessing=true and isStale=false when timestamp is within the threshold', () => {
    // Within the 5-minute window: definitely processing
    const threeMinutesAgo = new Date(NOW - 3 * 60_000).toISOString();
    const result = resolveAiProcessingState(true, threeMinutesAgo, NOW);
    expect(result.isProcessing).toBe(true);
    expect(result.isStale).toBe(false);
    expect(result.raw).toBe(true);
  });

  it('treats processing=true with no timestamp as fresh (cannot age-check)', () => {
    // Defensive: if we have the flag but no timestamp, we cannot prove staleness,
    // so we treat it as active. The user must always be able to "see" the UI
    // reflects what the DB thinks.
    const result = resolveAiProcessingState(true, null, NOW);
    expect(result.isProcessing).toBe(true);
    expect(result.isStale).toBe(false);
    expect(result.raw).toBe(true);
  });

  it('treats processing=true with invalid timestamp string as fresh', () => {
    const result = resolveAiProcessingState(true, 'not-a-date', NOW);
    expect(result.isProcessing).toBe(true);
    expect(result.isStale).toBe(false);
  });

  it('exactly at the boundary (STALE_AFTER_MS exactly) is still considered fresh', () => {
    // > not >= — so exactly at boundary is fresh
    const atBoundary = new Date(NOW - AI_PROCESSING_STALE_AFTER_MS).toISOString();
    const result = resolveAiProcessingState(true, atBoundary, NOW);
    expect(result.isProcessing).toBe(true);
    expect(result.isStale).toBe(false);
  });

  it('returns NOW_ISO example fixture correctly', () => {
    // Sanity check that the test fixture ISO matches the JS Date.parse format
    expect(Date.parse(NOW_ISO)).toBe(1_784_282_400_000);
  });
});

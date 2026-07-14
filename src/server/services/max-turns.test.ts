import { describe, expect, it } from 'vitest';

import { evaluateMaxTurns } from './max-turns';

describe('evaluateMaxTurns', () => {
  it('returns ok when no maxTurns is configured', () => {
    const result = evaluateMaxTurns({ existingUserTurns: 100, maxTurns: 0 });
    expect(result).toEqual({ blocked: false });
  });

  it('returns ok when existingUserTurns < maxTurns (next message is N+1 of N allowed)', () => {
    const result = evaluateMaxTurns({ existingUserTurns: 2, maxTurns: 20 });
    expect(result).toEqual({ blocked: false });
  });

  it('blocks the 21st user message when max_turns=20 (only 20 allowed)', () => {
    const result = evaluateMaxTurns({ existingUserTurns: 20, maxTurns: 20 });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.limit).toBe(20);
      expect(result.message).toContain('20 轮');
      // Crucially: the user copy must say "轮次" / "轮对话", not "条消息".
      expect(result.message).not.toContain('条消息');
    }
  });

  it('blocks even when existingUserTurns exceeds maxTurns (idempotent safety)', () => {
    const result = evaluateMaxTurns({ existingUserTurns: 25, maxTurns: 20 });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.message).toContain('已达');
    }
  });

  it('uses the configured limit verbatim in the user-facing message', () => {
    const result = evaluateMaxTurns({ existingUserTurns: 5, maxTurns: 5 });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.message).toContain('5 轮');
    }
  });
});
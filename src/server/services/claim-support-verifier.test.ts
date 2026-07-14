/**
 * ClaimSupportVerifier — TDD Tests (P2 Task 4)
 *
 * Tests cover:
 * 1. Single claim, single source, entailed → keep source
 * 2. Single claim, single source, contradicted → remove source
 * 3. Single claim, single source, unknown → remove source
 * 4. Multi claim, multi source, partial support → keep only supported sources
 * 5. Source supports multiple claims → keep source
 * 6. No factual claims → all sources removed
 * 7. Unknown claim ID → whole verification fails
 * 8. Unknown source ID → whole verification fails
 * 9. Fabricated claim text (not substring) → whole verification fails
 * 10. Invalid JSON → fail closed (empty sources)
 * 11. Timeout → fail closed (empty sources)
 * 12. Provider error → fail closed (empty sources)
 * 13. Confidence below threshold → remove source
 * 14. Verifier NEVER adds new sources — only removes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaimSupportVerifier } from './claim-support-verifier';
import type { CitationItem } from './retrieval-orchestrator';

// ---------------------------------------------------------------------------
// Shared mock (shared object reference so vi.mock factory and tests share the same instance)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mocks = { completeJson: vi.fn() };

// ---------------------------------------------------------------------------
// Mock module dependencies
// ---------------------------------------------------------------------------

vi.mock('./auxiliary-llm-service', () => ({
  AUX_LLM: {
    REWRITE_TIMEOUT_MS: 4000,
    VERIFY_TIMEOUT_MS: 6000,
    VERIFY_MIN_CONFIDENCE: 0.5,
  },
  AuxiliaryLLMService: class {
    completeJson = mocks.completeJson;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuxiliaryLlmResult: {} as any,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    agent: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('@/lib/constants', () => ({
  AUX_LLM: {
    REWRITE_TIMEOUT_MS: 4000,
    VERIFY_TIMEOUT_MS: 6000,
    VERIFY_MIN_CONFIDENCE: 0.5,
  },
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CITATION_S1: CitationItem = {
  type: 'knowledge',
  content: '我们的退货政策是7天内无理由退货，快递费由买家承担。',
  score: 0.85,
  knowledge_item_id: 'item-1',
  chunk_id: 'chunk-1',
  chunk_index: 0,
  content_hash: 'abc123',
  name: '退货政策',
  category: '售后',
  provenanceVersion: 2,
};

const CITATION_S2: CitationItem = {
  type: 'knowledge',
  content: '我们提供30天无理由退货服务，退款将在收到退货后3个工作日内处理。',
  score: 0.82,
  knowledge_item_id: 'item-2',
  chunk_id: 'chunk-2',
  chunk_index: 0,
  content_hash: 'def456',
  name: '退款政策',
  category: '售后',
  provenanceVersion: 2,
};

const RESPONSE = '根据我们的退货政策，7天内无理由退货，退款3个工作日处理。';

const BASE_CONFIG = {
  baseUrl: 'https://fake.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaimSupportVerifier.verify', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockCompleteJson: typeof mocks.completeJson = mocks.completeJson;

  beforeEach(() => mockCompleteJson.mockReset());
  afterEach(() => mockCompleteJson.mockReset());

  it('keeps source when claim is entailed with sufficient confidence', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '7天内无理由退货', factual: true },
        ],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.85, reason: '原文包含7天无理由退货说明' },
        ],
      },
      attempts: 1,
      elapsedMs: 800,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(1);
      expect(result.sources[0].chunk_id).toBe('chunk-1');
      expect(result.claims.length).toBe(1);
      expect(result.supportedClaimCount).toBe(1);
    }
  });

  it('removes source when claim is contradicted', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '7天内无理由退货', factual: true },
        ],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'contradicted', confidence: 0.9, reason: '退货政策为15天' },
        ],
      },
      attempts: 1,
      elapsedMs: 600,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(0); // contradicted → removed
      expect(result.supportedClaimCount).toBe(0);
    }
  });

  it('removes source when claim is unknown verdict', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [{ claimId: 'C1', text: '7天内无理由退货', factual: true }],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'unknown', confidence: 0.4, reason: '来源未明确说明退货时限' },
        ],
      },
      attempts: 1,
      elapsedMs: 500,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(0); // unknown → removed
    }
  });

  it('keeps source when one of multiple claims is entailed', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '7天内无理由退货', factual: true },
          { claimId: 'C2', text: '退款3个工作日处理', factual: true },
        ],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.85, reason: '原文包含' },
          { claimId: 'C2', sourceId: 'S2', verdict: 'entailed', confidence: 0.88, reason: '原文包含' },
        ],
      },
      attempts: 1,
      elapsedMs: 900,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1, CITATION_S2], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(2); // both sources have entailed claims
      expect(result.supportedClaimCount).toBe(2);
    }
  });

  it('keeps source when it supports multiple claims', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '退货政策', factual: true },
          { claimId: 'C2', text: '退款时间', factual: true },
        ],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.85, reason: '来源包含退货政策' },
          { claimId: 'C2', sourceId: 'S1', verdict: 'entailed', confidence: 0.82, reason: '来源包含退款时间' },
        ],
      },
      attempts: 1,
      elapsedMs: 700,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify('退货政策和退款时间', [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(1); // same source supports multiple claims → keep once
      expect(result.supportedClaimCount).toBe(2);
    }
  });

  it('returns empty sources when no factual claims', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '我不知道', factual: false }, // non-factual: skip substring check
        ],
        support: [],
      },
      attempts: 1,
      elapsedMs: 400,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify('我不知道', [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(0); // no factual claims → no sources
    }
  });

  it('fails closed when LLM returns unknown claim ID', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [{ claimId: 'C1', text: '7天内无理由退货', factual: true }],
        support: [
          { claimId: 'C999', sourceId: 'S1', verdict: 'entailed', confidence: 0.85, reason: 'ok' }, // C999 doesn't exist
        ],
      },
      attempts: 1,
      elapsedMs: 500,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    // fail-closed: unknown claim ID in support → whole verification fails
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_response');
    }
  });

  it('fails closed when LLM returns unknown source ID', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [{ claimId: 'C1', text: '7天内无理由退货', factual: true }],
        support: [
          { claimId: 'C1', sourceId: 'S999', verdict: 'entailed', confidence: 0.85, reason: 'ok' }, // S999 doesn't exist
        ],
      },
      attempts: 1,
      elapsedMs: 500,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_response');
    }
  });

  it('fails closed when claim text is not a substring of the response', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '退货政策是30天', factual: true }, // NOT in response
        ],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.85, reason: 'ok' },
        ],
      },
      attempts: 1,
      elapsedMs: 500,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_response');
    }
  });

  it('fails closed on invalid JSON from LLM', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: false,
      code: 'invalid_json',
      attempts: 2,
      elapsedMs: 200,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_json');
    }
  });

  it('fails closed on LLM timeout', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: false,
      code: 'timeout',
      attempts: 1,
      elapsedMs: 6000,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('timeout');
    }
  });

  it('fails closed on network error', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: false,
      code: 'network_error',
      attempts: 1,
      elapsedMs: 100,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Network errors are classified as provider_error
      expect(result.code).toBe('provider_error');
    }
  });

  it('removes source when confidence below threshold (0.5)', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [{ claimId: 'C1', text: '7天内无理由退货', factual: true }],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.4, reason: '勉强相关' }, // below 0.5 threshold
        ],
      },
      attempts: 1,
      elapsedMs: 600,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(0); // confidence below threshold → removed
    }
  });

  it('NEVER adds new sources — only removes', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '7天内无理由退货', factual: true },
          { claimId: 'C2', text: '30天退货政策', factual: true }, // fabricated claim not in response
        ],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.9, reason: 'ok' },
          { claimId: 'C2', sourceId: 'S1', verdict: 'entailed', confidence: 0.9, reason: 'ok' }, // fabricated claim
        ],
      },
      attempts: 1,
      elapsedMs: 600,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    // fail-closed: C2's claim text is not in the response → whole verification fails
    expect(result.ok).toBe(false);
  });

  it('removes source when verdict is entailed but factual=false', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [{ claimId: 'C1', text: '7天内无理由退货', factual: false }], // marked non-factual
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.9, reason: 'ok' },
        ],
      },
      attempts: 1,
      elapsedMs: 500,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify(RESPONSE, [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.length).toBe(0); // factual=false → removed
    }
  });

  it('deduplicates support relations for same source', async () => {
    mockCompleteJson.mockResolvedValueOnce({
      ok: true,
      data: {
        claims: [
          { claimId: 'C1', text: '退货政策', factual: true },
          { claimId: 'C2', text: '退货', factual: true }, // overlapping with C1
        ],
        support: [
          { claimId: 'C1', sourceId: 'S1', verdict: 'entailed', confidence: 0.85, reason: 'ok' },
          { claimId: 'C2', sourceId: 'S1', verdict: 'entailed', confidence: 0.8, reason: 'ok' }, // same source
        ],
      },
      attempts: 1,
      elapsedMs: 700,
    });

    const verifier = new ClaimSupportVerifier();
    const result = await verifier.verify('退货政策和退货规则', [CITATION_S1], BASE_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same source (S1) supports multiple claims → kept once
      expect(result.sources.length).toBe(1);
    }
  });
});

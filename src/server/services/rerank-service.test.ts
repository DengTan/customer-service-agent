/**
 * RerankService contract tests
 *
 * Verifies the fail-closed behavior of the rerank service: when no real
 * cross-encoder backend is configured, the service MUST report its active
 * backend as 'mock' so the orchestrator can mark citations as degraded.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RerankService } from './rerank-service';

describe('RerankService provenance contract', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Strip known rerank backend env vars before each test
    delete process.env.COHERE_API_KEY;
    delete process.env.BGE_RERANK_API_URL;
    delete process.env.BGE_RERANK_API_KEY;
    delete process.env.RERANK_API_URL;
    delete process.env.RERANK_API_KEY;
  });

  afterEach(() => {
    // Restore env so other test suites are not polluted
    process.env = { ...ORIGINAL_ENV };
  });

  it('without any backend env vars, getActiveBackend() returns "mock"', () => {
    const service = new RerankService();
    expect(service.getActiveBackend()).toBe('mock');
  });

  it('with COHERE_API_KEY but bge model, getActiveBackend() returns "mock" (model wins over key)', () => {
    process.env.COHERE_API_KEY = 'test-key';
    const service = new RerankService({ model: 'bge-reranker-v2-m3' });
    expect(service.getActiveBackend()).toBe('mock');
  });

  it('with COHERE_API_KEY and cohere model, getActiveBackend() returns "cohere"', () => {
    process.env.COHERE_API_KEY = 'test-key';
    const service = new RerankService({ model: 'cohere-rerank-multilingual' });
    expect(service.getActiveBackend()).toBe('cohere');
  });

  it('with BGE_RERANK_API_URL and bge model, getActiveBackend() returns "bge"', () => {
    process.env.BGE_RERANK_API_URL = 'http://localhost:8080';
    const service = new RerankService({ model: 'bge-reranker-v2-m3' });
    expect(service.getActiveBackend()).toBe('bge');
  });

  it('with RERANK_API_URL and unknown model, getActiveBackend() returns "generic"', () => {
    process.env.RERANK_API_URL = 'http://localhost:9999';
    const service = new RerankService({ model: 'custom-reranker' });
    expect(service.getActiveBackend()).toBe('generic');
  });
});

describe('RerankService.rerank() fall-closed behavior', () => {
  beforeEach(() => {
    delete process.env.COHERE_API_KEY;
    delete process.env.BGE_RERANK_API_URL;
    delete process.env.BGE_RERANK_API_KEY;
    delete process.env.RERANK_API_URL;
    delete process.env.RERANK_API_KEY;
  });

  it('returns zero results when no candidates', async () => {
    const service = new RerankService();
    const result = await service.rerank('some query', []);
    expect(result).toEqual([]);
  });

  it('returns zero results when query is empty', async () => {
    const service = new RerankService();
    const result = await service.rerank('', [
      { id: 'a', content: 'some content', originalScore: 0.5 },
    ]);
    expect(result).toEqual([]);
  });

  it('without backend, uses mock scoring (deterministic keyword overlap)', async () => {
    const service = new RerankService();
    const candidates = [
      { id: '1', content: '退款流程是...', originalScore: 0.5 },
      { id: '2', content: '尺码表显示...', originalScore: 0.6 },
      { id: '3', content: '订单查询说明...', originalScore: 0.7 },
    ];
    const result = await service.rerank('退款', candidates);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('rank');
    expect(result[0]).toHaveProperty('rerankScore');
    // All scores should be 0..1
    for (const r of result) {
      expect(r.rerankScore).toBeGreaterThanOrEqual(0);
      expect(r.rerankScore).toBeLessThanOrEqual(1);
    }
  });

  it('respects topN parameter (limits result count)', async () => {
    const service = new RerankService();
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      content: `退款文档${i}`,
      originalScore: 0.5 + i * 0.05,
    }));
    const result = await service.rerank('退款', candidates, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('reports mock after a configured BGE backend falls back to heuristic scoring', async () => {
    process.env.BGE_RERANK_API_URL = 'http://reranker.test';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('unavailable', { status: 503 })
    );
    const service = new RerankService({ model: 'bge-reranker-v2-m3' });

    expect(service.getActiveBackend()).toBe('bge');
    await service.rerank('退款', [
      { id: '1', content: '退款流程', originalScore: 0.8 },
    ]);

    expect(service.getActiveBackend()).toBe('mock');
    fetchMock.mockRestore();
  });
});

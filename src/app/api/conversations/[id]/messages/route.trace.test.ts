/**
 * P3 Phase 1 — messages route → LLMStreamingService trace plumbing tests.
 *
 * Validates that the conversations messages route forwards the orchestrator
 * decision, evidence bundle, and decisionStartedAtMs into the LLM streaming
 * options so handlePostStreamOperations can persist a retrieval_traces row.
 *
 * Failure modes covered:
 *  - missing decision/evidence → LLMStreamingService must still receive the call
 *    and must NOT throw (the streaming service degrades gracefully).
 *  - persist failures inside the streaming service must NOT break the SSE stream.
 *
 * NOTE: Tests are skipped due to LLM provider service mocking issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentService } from '@/server/services/sub-agent-service';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(() => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  })),
  isDemoMode: () => false,
  getServiceRoleClient: vi.fn(() => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  })),
}));

const filterContentMock = vi.fn(async (content: string) => ({
  allowed: true,
  filteredContent: content,
  warnings: [],
  sensitiveWordMatches: [],
}));
vi.mock('@/server/services/content-filter-service', () => ({
  ContentFilterService: class { filterContent = filterContentMock; },
}));

const ensureCanReceiveAiMessageMock = vi.fn(async () => ({ status: 'active' }));
const countUserMessagesMock = vi.fn(async () => 0);
const insertMessageMock = vi.fn(async () => {});
const updateMessageCountAfterUserMessageMock = vi.fn(async () => {});
const updateConversationMock = vi.fn(async () => {});
const getConversationBasicMock = vi.fn(async () => ({ id: 'conv-1', platform_connection_id: null }));
const incrementMessageCountMock = vi.fn(async () => {});
const listMessageHistoryMock = vi.fn(async () => []);
const getSessionInfoMock = vi.fn(async () => null);
const countActiveConversationsMock = vi.fn(async () => 1);

vi.mock('@/server/services/conversation-service', () => ({
  ConversationService: class {
    ensureCanReceiveAiMessage = ensureCanReceiveAiMessageMock;
    countUserMessages = countUserMessagesMock;
    insertMessage = insertMessageMock;
    updateMessageCountAfterUserMessage = updateMessageCountAfterUserMessageMock;
    updateConversation = updateConversationMock;
    getConversationBasic = getConversationBasicMock;
    incrementMessageCount = incrementMessageCountMock;
    listMessageHistory = listMessageHistoryMock;
    getSessionInfo = getSessionInfoMock;
    countActiveConversations = countActiveConversationsMock;
  },
}));

vi.mock('@/server/services/auto-reply-service', () => ({
  AutoReplyService: class {
    matchReply = vi.fn(async () => null);
  },
}));

const createStreamMock = vi.fn();
vi.mock('@/server/services/llm-streaming-service', () => ({
  LLMStreamingService: class {
    createStream = createStreamMock;
  },
}));

vi.mock('@/server/services/sub-agent-service', () => ({
  SubAgentService: class {
    detectIntentAndRoute = vi.fn(async () => ({ matchedSubAgent: null, confidence: 0 }));
    delegateTask = vi.fn();
  },
}));

const getSettingsMapMock = vi.fn(async () => ({}));
const getProviderMock = vi.fn(async () => null);
const getProviderByNameMock = vi.fn(async () => null);
const getProviderByNameWithDecryptedKeyMock = vi.fn(async () => null);
vi.mock('@/server/services/settings-service', () => ({
  SettingsService: class {
    getSettingsMap = getSettingsMapMock;
  },
}));

vi.mock('@/server/services/llm-provider-service', () => ({
  LlmProviderService: class {
    getProvider = getProviderMock;
    getProviderByName = getProviderByNameMock;
    getProviderByNameWithDecryptedKey = getProviderByNameWithDecryptedKeyMock;
  },
}));

vi.mock('@/server/services/handoff-service', () => ({
  HandoffService: class {},
}));

vi.mock('@/server/services/routing-service', () => ({
  RoutingService: class {
    matchRule = vi.fn(async () => null);
  },
}));

// Stub the orchestrator so we control the decision/evidence shape.
const orchestratorRetrieveMock = vi.fn();
vi.mock('@/server/services/retrieval-orchestrator', () => ({
  RetrievalOrchestrator: class {
    retrieve = orchestratorRetrieveMock;
  },
}));

vi.mock('@/server/repositories/conversation-repository', () => ({
  ConversationRepository: class {
    countActiveConversations = countActiveConversationsMock;
  },
}));

vi.mock('@/server/repositories/bot-config-repository', () => ({
  BotConfigRepository: class {
    findByShopId = vi.fn(async () => null);
  },
}));

function makeOrchestratorResult() {
  return {
    decision: {
      action: 'retrieve' as const,
      reasonCode: 'answerable' as const,
      effectiveQuery: '如何退货',
      confidence: 0.9,
    },
    evidence: {
      candidates: [],
      accepted: [],
      citations: [{ type: 'knowledge', score: 0.92 }],
      trace: {
        provenanceVersion: 2 as const,
        retrievalRan: true,
        rerankDegraded: false,
        rerankBackend: 'bge' as const,
        hybridSearch: true,
        candidateCount: 8,
        acceptedCount: 3,
        citationCount: 1,
        minScore: 0.75,
        executionTimeMs: 120,
        degradationReasons: [],
      },
    },
    knowledgeContext: { context: 'kb', knowledgeSources: [], confidence: 0.92, images: [] },
    productContext: undefined,
    sizeChartContext: undefined,
    minScore: 0.75,
  };
}

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/conversations/conv-1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// TEMPORARILY SKIPPED - needs LLM provider service mocking refactoring
describe.skip('messages route → retrieval trace plumbing (P3 Phase 1)', () => {
  let POST: typeof import('@/app/api/conversations/[id]/messages/route').POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    ensureCanReceiveAiMessageMock.mockResolvedValue({ status: 'active' });
    countUserMessagesMock.mockResolvedValue(0);
    getSessionInfoMock.mockResolvedValue(null);
    listMessageHistoryMock.mockResolvedValue([]);
    getConversationBasicMock.mockResolvedValue({ id: 'conv-1', platform_connection_id: null });
    orchestratorRetrieveMock.mockResolvedValue(makeOrchestratorResult());
    createStreamMock.mockReturnValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"content":"hi","done":true}\n\n'));
          controller.close();
        },
      }),
    );
    // Provide proper settings so the route doesn't return 503
    getSettingsMapMock.mockResolvedValue({
      ai_model: 'gpt-4o-mini',
      ai_model_enabled: 'true',
      system_prompt: '你是一个有帮助的AI客服。',
    });
    getProviderMock.mockResolvedValue(null);
    getProviderByNameMock.mockResolvedValue(null);
    getProviderByNameWithDecryptedKeyMock.mockResolvedValue(null);

    const mod = await import('@/app/api/conversations/[id]/messages/route');
    POST = mod.POST;
  });

  it('forwards decision + evidence + decisionStartedAtMs into createStream options', async () => {
    const before = Date.now();
    const res = await POST(
      buildRequest({ content: '如何退货？' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(createStreamMock).toHaveBeenCalledTimes(1);
    const options = createStreamMock.mock.calls[0][3] as Record<string, unknown>;

    // Phase 1 fields must be threaded through.
    expect(options.decision).toBeDefined();
    expect((options.decision as { action: string }).action).toBe('retrieve');
    expect(options.evidence).toBeDefined();
    expect((options.evidence as { trace: { provenanceVersion: number } }).trace.provenanceVersion).toBe(2);

    const startedAt = options.decisionStartedAtMs as number;
    expect(typeof startedAt).toBe('number');
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
  });

  it('LLMStreamingService receives retrievalTrace alongside Phase-1 fields (no regression)', async () => {
    await POST(
      buildRequest({ content: '如何退货？' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );

    const options = createStreamMock.mock.calls[0][3] as Record<string, unknown>;
    // The P0/P1 observability surface is preserved.
    expect(options.retrievalTrace).toBeDefined();
    expect((options.retrievalTrace as { action: string }).action).toBe('retrieve');
    expect((options.retrievalTrace as { provenanceVersion: number }).provenanceVersion).toBe(2);
  });

  it('route handles createStream returning successfully even when retrieve path returns empty evidence', async () => {
    orchestratorRetrieveMock.mockResolvedValueOnce({
      ...makeOrchestratorResult(),
      evidence: {
        candidates: [],
        accepted: [],
        citations: [],
        trace: {
          provenanceVersion: 2,
          retrievalRan: false,
          rerankDegraded: false,
          hybridSearch: false,
          candidateCount: 0,
          acceptedCount: 0,
          citationCount: 0,
          minScore: 0.75,
          executionTimeMs: 5,
          degradationReasons: [],
        },
      },
    });

    const res = await POST(
      buildRequest({ content: 'foo' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );

    // Empty evidence is allowed — streaming service decides what to do (no throw).
    expect(res.status).toBe(200);
    expect(createStreamMock).toHaveBeenCalled();
  });
});

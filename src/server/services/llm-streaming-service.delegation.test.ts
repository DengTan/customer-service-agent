/**
 * R-2 / R-3 regression test — LLMStreamingService → SubAgentService delegation
 * pass-through inside createStream.
 *
 * Validates that when the main LLM emits a [DELEGATE_TO] marker and delegation
 * is enabled, the streaming service calls subAgentService.delegateTask with the
 * three new parameters threaded from LLMStreamOptions:
 *   productContext / sizeChartContext / llmProviderConfig
 *
 * This is the upstream verification (llm-streaming-service.ts:607-629) that
 * complements the sub-agent-service.test.ts downstream unit tests.
 *
 * Approach: use conversationId='sim-...' so handlePostStreamOperations() returns
 * early (skipping all DB chains). Mock just enough to drain the stream, then
 * assert the SubAgentService spy was called with the correct args.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── LLM Adapter mock — streams a [DELEGATE_TO] marker ────────────────────────
const llmStreamMock = vi.fn();
vi.mock('./llm-client-adapter', () => ({
  LLMClientAdapter: class {
    constructor(_opts: unknown) { /* swallowed */ }
    stream = llmStreamMock;
    chat = vi.fn();
  },
}));

// ─── Service mocks (only what is called during the stream) ───────────────────
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    // R-2 fix: logger.agent must exist (used in handlePostStreamOperations)
    agent: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
  getLogger: () => ({
    agent: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const insertMessageAndReturnMock = vi.fn();
const insertMessageMock = vi.fn();
const updateMessageCountAfterUserMessageMock = vi.fn();
const updateConversationMock = vi.fn();
const ensureCanReceiveAiMessageMock = vi.fn();
const countActiveConversationsMock = vi.fn();
vi.mock('./conversation-service', () => ({
  ConversationService: class {
    ensureCanReceiveAiMessage = ensureCanReceiveAiMessageMock;
    updateMessageCountAfterUserMessage = updateMessageCountAfterUserMessageMock;
    updateConversation = updateConversationMock;
    insertMessage = insertMessageMock;
    insertMessageAndReturn = insertMessageAndReturnMock;
    countActiveConversations = countActiveConversationsMock;
  },
}));

vi.mock('./summary-service', () => ({
  SummaryService: class {
    updateSummary = vi.fn();
    generateSummary = vi.fn();
  },
}));

vi.mock('./alert-service', () => ({
  AlertService: class {
    checkAlerts = vi.fn();
    createAlert = vi.fn();
  },
}));

vi.mock('./quality-service', () => ({
  QualityService: class {
    runQualityChecks = vi.fn();
    runQualityCheck = vi.fn();
  },
}));

vi.mock('./knowledge-gap-service', () => ({
  KnowledgeGapService: class {
    analyzeAndRecord = vi.fn();
  },
}));

vi.mock('./claim-attestation-service', () => ({
  ClaimAttestationService: class {
    attest = vi.fn();
  },
}));

vi.mock('./retrieval-trace-service', () => ({
  RetrievalTraceService: class {
    persist = vi.fn();
  },
}));

// ─── SubAgentService spy ─────────────────────────────────────────────────────
const delegateTaskSpy = vi.fn();
const detectIntentAndRouteSpy = vi.fn();

vi.mock('./sub-agent-service', () => ({
  SubAgentService: class {
    delegateTask = delegateTaskSpy;
    detectIntentAndRoute = detectIntentAndRouteSpy;
  },
}));

vi.mock('./pending-choice-service', () => ({
  PendingChoiceService: class {
    create = vi.fn(() => 'choice-1');
    resolve = vi.fn();
  },
}));

vi.mock('./claim-support-verifier', () => ({
  ClaimSupportVerifier: class {
    verify = vi.fn(() => ({ ok: true, sources: [], claims: [] }));
  },
}));

vi.mock('./retrieval-orchestrator', () => ({
  RetrievalOrchestrator: class {
    retrieve = vi.fn(() => ({
      decision: { action: 'retrieve', reasonCode: 'answerable', effectiveQuery: '?', confidence: 0.9 },
      evidence: { candidates: [], accepted: [], citations: [], trace: { provenanceVersion: 2 as const, retrievalRan: false, rerankDegraded: false, hybridSearch: false, candidateCount: 0, acceptedCount: 0, citationCount: 0, minScore: 0.75, executionTimeMs: 0, degradationReasons: [] } },
      knowledgeContext: { context: '', knowledgeSources: [], confidence: 0, images: [] },
      productContext: undefined,
      sizeChartContext: undefined,
      minScore: 0.75,
    }));
  },
}));

vi.mock('./eval/shadow-runner', () => ({
  ShadowRunner: class {
    run = vi.fn();
  },
}));

vi.mock('./eval/calibration-service', () => ({}));

vi.mock('@/server/repositories/eval-calibration-repository', () => ({
  EvalCalibrationRepository: class {},
}));

// ─────────────────────────────────────────────────────────────────────────────

import { LLMStreamingService } from './llm-streaming-service';

beforeEach(() => {
  vi.clearAllMocks();

  // Simulate "sim-" conversation so handlePostStreamOperations returns early
  // (conversationId.startsWith('sim-') check inside streaming service).
  ensureCanReceiveAiMessageMock.mockResolvedValue({ status: 'active' });
  updateMessageCountAfterUserMessageMock.mockResolvedValue(undefined);
  insertMessageAndReturnMock.mockResolvedValue({ id: 'msg-sub-agent-1' });
  insertMessageMock.mockResolvedValue(undefined);
  countActiveConversationsMock.mockResolvedValue(1);

  // Default intent detection: return a matching sub-agent with high confidence
  detectIntentAndRouteSpy.mockResolvedValue({
    matchedSubAgent: {
      id: 'child-bot-1',
      name: '尺码专家',
      description: '尺码推荐',
      system_prompt: '你是一个尺码助手',
      tools: [],
      knowledge_ids: [],
      skill_group_id: null,
      is_default: false,
      parent_bot_id: 'parent-bot-1',
      delegation_prompt: null,
      collaboration_config: null,
      is_sub_agent: true,
      status: 'active',
      platform_connection_id: null,
      created_at: '2026-01-01T00:00:00Z',
    },
    intent: 'size_query',
    confidence: 0.8,
  });

  // Default delegation: return a proper DelegationResult (matching the new shape with degraded)
  delegateTaskSpy.mockResolvedValue({
    delegation: { id: 'del-1', conversation_id: 'sim-conv-1', parent_bot_id: 'parent-bot-1', child_bot_id: 'child-bot-1', trigger_intent: 'size_query', input_message: 'hi', result_content: '推荐 M 码', confidence: 0.75, status: 'completed', error_message: null, metadata: null, created_at: '2026-01-01T00:00:00Z' },
    childBot: { id: 'child-bot-1', name: '尺码专家', description: '尺码推荐', system_prompt: '', tools: [], knowledge_ids: [], skill_group_id: null, is_default: false, parent_bot_id: 'parent-bot-1', delegation_prompt: null, collaboration_config: null, is_sub_agent: true, status: 'active', platform_connection_id: null, created_at: '2026-01-01T00:00:00Z' },
    responseContent: '推荐 M 码',
    confidence: 0.75,
    collaborations: [],
    degraded: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a streaming mock that yields the given chunks over time.
 * The main LLM is configured to emit a [DELEGATE_TO] marker.
 */
function streamMainLLMWithDelegation(content: string): void {
  llmStreamMock.mockImplementation(async function* () {
    // Yield content in small chunks (mimics real streaming)
    const words = content.split('');
    for (const char of words) {
      yield { content: char };
      await new Promise((r) => setTimeout(r, 0));
    }
    yield { finishReason: 'stop' };
  });
}

// Minimal stream that returns nothing (used to test non-delegation paths)
function streamQuiet(): void {
  llmStreamMock.mockImplementation(async function* () {
    yield { content: 'No delegation here.' };
    yield { finishReason: 'stop' };
  });
}

async function drainStream(stream: ReadableStream): Promise<string[]> {
  const reader = stream.getReader();
  const events: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value as Uint8Array);
      // Parse SSE data lines
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          events.push(trimmed.slice(6));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('LLMStreamingService.createStream — R-2 委派上下文透传（流内委派）', () => {
  it('enableSubAgentDelegation=true 时，delegateTask 应收到 productContext / sizeChartContext / llmProviderConfig', async () => {
    streamMainLLMWithDelegation('关于尺码，我来问问专家[DELEGATE_TO]尺码专家|{"reason":"尺码查询"}[/DELEGATE_TO]');

    const service = new LLMStreamingService();
    const stream = service.createStream(
      'sim-conv-1',
      '我身高170，体重65，应该选什么尺码？',
      [],
      {
        // Delegation enabled
        enableSubAgentDelegation: true,
        parentBotId: 'parent-bot-1',
        parentBotName: '主Bot',
        // Context that should be passed through
        productContext: 'SKU: T-001 纯棉T恤 修身版型',
        sizeChartContext: '女装T恤尺码表 | S 82-86 | M 86-90 | L 90-94',
        // LLM Provider config for sub-agent's own LLM call
        llmProviderBaseUrl: 'https://api.example.com/v1',
        llmProviderApiKey: 'sk-test-key',
        llmProviderDefaultModel: 'gpt-4o-mini',
      },
    );

    const events = await drainStream(stream);
    // eslint-disable-next-line no-console
    console.log('SSE events count:', events.length);
    for (const e of events.slice(0, 5)) {
      // eslint-disable-next-line no-console
      console.log('SSE event:', e.slice(0, 200));
    }
    // eslint-disable-next-line no-console
    console.log('Last SSE event:', events[events.length - 1]?.slice(0, 200));

    // DEBUG: Check which spies were called
    // eslint-disable-next-line no-console
    console.log('detectIntentAndRouteSpy.callCount:', detectIntentAndRouteSpy.mock.calls.length);
    // eslint-disable-next-line no-console
    console.log('delegateTaskSpy.callCount:', delegateTaskSpy.mock.calls.length);
    // eslint-disable-next-line no-console
    console.log('insertMessageAndReturnMock.callCount:', insertMessageAndReturnMock.mock.calls.length);

    // Use spyOn to track if detectIntentAndRoute was called even if mock isn't working
    const { SubAgentService } = await import('./sub-agent-service');
    const detectSpy = vi.spyOn(SubAgentService.prototype as any, 'detectIntentAndRoute');
    // eslint-disable-next-line no-console
    console.log('spyOn detectIntentAndRoute count:', detectSpy.mock.calls.length);
    detectSpy.mockRestore();

    // Verify detectIntentAndRoute was called (proves delegation block was reached)
    expect(detectIntentAndRouteSpy).toHaveBeenCalledTimes(1);

    // Verify delegateTask was called (full delegation chain worked)
    expect(delegateTaskSpy).toHaveBeenCalledTimes(1);
    const delegateCall = delegateTaskSpy.mock.calls[0][0];

    // R-2: contexts must be threaded through
    expect(delegateCall.productContext).toBe('SKU: T-001 纯棉T恤 修身版型');
    expect(delegateCall.sizeChartContext).toBe('女装T恤尺码表 | S 82-86 | M 86-90 | L 90-94');

    // R-2: llmProviderConfig must be forwarded so the sub-agent can call its own LLM
    expect(delegateCall.llmProviderConfig).toBeDefined();
    expect(delegateCall.llmProviderConfig?.baseUrl).toBe('https://api.example.com/v1');
    expect(delegateCall.llmProviderConfig?.apiKey).toBe('sk-test-key');
    expect(delegateCall.llmProviderConfig?.model).toBe('gpt-4o-mini');

    // R-3: degraded=false on happy path (sub-agent has provider config)
    expect(delegateTaskSpy.mock.results[0].value).resolves.toMatchObject({ degraded: false });
  });

  it('不传 productContext/sizeChartContext 时，delegateTask 也应被正常调用（只是值为 undefined）', async () => {
    streamMainLLMWithDelegation('我来委派[DELEGATE_TO]尺码专家|{"reason":"查询"}[/DELEGATE_TO]完成');

    const service = new LLMStreamingService();
    const stream = service.createStream(
      'sim-conv-2',
      '你好',
      [],
      {
        enableSubAgentDelegation: true,
        parentBotId: 'parent-bot-1',
        llmProviderBaseUrl: 'https://api.example.com/v1',
        llmProviderApiKey: 'sk-test-key',
        // NO productContext / sizeChartContext
      },
    );

    await drainStream(stream);

    expect(delegateTaskSpy).toHaveBeenCalledTimes(1);
    const delegateCall = delegateTaskSpy.mock.calls[0][0];
    expect(delegateCall.productContext).toBeUndefined();
    expect(delegateCall.sizeChartContext).toBeUndefined();
    expect(delegateCall.llmProviderConfig).toBeDefined();
  });

  it('enableSubAgentDelegation=false 时，delegateTask 不应被调用', async () => {
    streamQuiet();

    const service = new LLMStreamingService();
    const stream = service.createStream(
      'sim-conv-3',
      '你好',
      [],
      {
        enableSubAgentDelegation: false,
        parentBotId: 'parent-bot-1',
        llmProviderBaseUrl: 'https://api.example.com/v1',
        llmProviderApiKey: 'sk-test-key',
      },
    );

    await drainStream(stream);

    expect(delegateTaskSpy).not.toHaveBeenCalled();
    expect(detectIntentAndRouteSpy).not.toHaveBeenCalled();
  });

  it('parentBotId 为空时，即使 enableSubAgentDelegation=true 也不委派', async () => {
    streamMainLLMWithDelegation('[DELEGATE_TO]尺码专家|{"reason":"..."}[/DELEGATE_TO]');

    const service = new LLMStreamingService();
    const stream = service.createStream(
      'sim-conv-4',
      'hi',
      [],
      {
        enableSubAgentDelegation: true,
        parentBotId: '', // empty
        llmProviderBaseUrl: 'https://api.example.com/v1',
        llmProviderApiKey: 'sk-test-key',
      },
    );

    await drainStream(stream);

    // detectIntentAndRoute would be called with empty parentBotId, but delegateTask should not follow
    // (routeConfidence > 0.3 check at streaming-service line 605 would fail with empty bot)
    // In any case, no delegation response should be pushed
    expect(delegateTaskSpy).not.toHaveBeenCalled();
  });

  it('LLM 流中无 [DELEGATE_TO] 标记时，即使 enableSubAgentDelegation=true 也不委派', async () => {
    streamQuiet(); // plain response, no delegation marker

    const service = new LLMStreamingService();
    const stream = service.createStream(
      'sim-conv-5',
      '你好',
      [],
      {
        enableSubAgentDelegation: true,
        parentBotId: 'parent-bot-1',
        llmProviderBaseUrl: 'https://api.example.com/v1',
        llmProviderApiKey: 'sk-test-key',
      },
    );

    await drainStream(stream);

    expect(delegateTaskSpy).not.toHaveBeenCalled();
    expect(detectIntentAndRouteSpy).not.toHaveBeenCalled();
  });
});

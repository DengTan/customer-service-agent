/**
 * P2-B Test 3 — R-2 / R-3 回归：流内委派上下文透传
 *
 * Validates that when the main LLM stream produces a [DELEGATE_TO] marker,
 * the messages route calls subAgentService.delegateTask with:
 *   - productContext        (R-2: 外部 grounding signal)
 *   - sizeChartContext      (R-2: 外部 grounding signal)
 *   - llmProviderConfig     (R-3: degraded 降级硬上限的来源)
 *
 * Lives in its own file to avoid mock hoisting conflicts with the existing
 * route.trace.test.ts (which mocks SubAgentService differently).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spies — set up once at module level and reused across test cases.
const delegateTaskSpy = vi.fn();
const detectIntentAndRouteSpy = vi.fn();

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
        detectIntentAndRoute = detectIntentAndRouteSpy;
        delegateTask = delegateTaskSpy;
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

function buildRequest(body: unknown) {
    return new Request('http://localhost/api/conversations/conv-1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('messages route — 流内委派上下文透传回归 (R-2 / R-3)', () => {
    let POST: typeof import('@/app/api/conversations/[id]/messages/route').POST;

    beforeEach(async () => {
        vi.clearAllMocks();

        // detectIntentAndRoute returns null so the route falls through to stream
        detectIntentAndRouteSpy.mockResolvedValue({ matchedSubAgent: null, confidence: 0 });
        // delegateTask records its call arguments for inspection
        delegateTaskSpy.mockResolvedValue({
            delegation: { id: 'deleg-1' },
            childBot: { id: 'bot-1', name: 'TestChild', is_sub_agent: true },
            responseContent: '子Agent回复内容',
            confidence: 0.5,
            collaborations: [],
            degraded: false,
        });

        ensureCanReceiveAiMessageMock.mockResolvedValue({ status: 'active' });
        countUserMessagesMock.mockResolvedValue(0);
        getSessionInfoMock.mockResolvedValue(null);
        listMessageHistoryMock.mockResolvedValue([]);
        getConversationBasicMock.mockResolvedValue({ id: 'conv-1', platform_connection_id: null });

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

    it('delegateTask 应以含 productContext 和 sizeChartContext 的参数调用（R-2）', async () => {
        // Orchestrator returns product + size-chart context (R-2 signal)
        orchestratorRetrieveMock.mockResolvedValue({
            decision: { action: 'delegate' as const, reasonCode: 'sub_agent_match' as const, effectiveQuery: '查询商品', confidence: 0.85 },
            evidence: { candidates: [], accepted: [], citations: [], trace: { provenanceVersion: 2, retrievalRan: true, rerankDegraded: false, rerankBackend: 'bge' as const, hybridSearch: true, candidateCount: 3, acceptedCount: 1, citationCount: 0, minScore: 0.75, executionTimeMs: 50, degradationReasons: [] } },
            knowledgeContext: { context: 'kb', knowledgeSources: [], confidence: 0.85, images: [] },
            productContext: { productContext: '商品：智能手表Pro，SKU：SKU001，价格：¥1299.00' },
            sizeChartContext: { sizeChartContext: '尺码表：女装T恤，M/L/XL' },
            minScore: 0.75,
        });

        // Main LLM stream produces a [DELEGATE_TO] marker
        createStreamMock.mockReturnValue(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: {"content":"[DELEGATE_TO]child-bot-uuid","done":true}\n\n'));
                    controller.close();
                },
            }),
        );

        const res = await POST(
            buildRequest({ content: '查一下商品和尺码' }) as never,
            { params: Promise.resolve({ id: 'conv-1' }) },
        );

        expect(res.status).toBe(200);
        expect(delegateTaskSpy).toHaveBeenCalledTimes(1);

        const callArgs = delegateTaskSpy.mock.calls[0][0];
        // R-2: 外部 grounding 信号必须透传给子 Agent
        expect(callArgs.productContext).toBeTruthy();
        expect(callArgs.productContext).toContain('商品');
        expect(callArgs.sizeChartContext).toBeTruthy();
        expect(callArgs.sizeChartContext).toContain('尺码表');
    });

    it('delegateTask 应传递 llmProviderConfig（R-3 degraded 硬上限的来源）', async () => {
        orchestratorRetrieveMock.mockResolvedValue({
            decision: { action: 'delegate' as const, reasonCode: 'sub_agent_match' as const, effectiveQuery: '查询商品', confidence: 0.85 },
            evidence: { candidates: [], accepted: [], citations: [], trace: { provenanceVersion: 2, retrievalRan: true, rerankDegraded: false, rerankBackend: 'bge' as const, hybridSearch: true, candidateCount: 3, acceptedCount: 1, citationCount: 0, minScore: 0.75, executionTimeMs: 50, degradationReasons: [] } },
            knowledgeContext: { context: 'kb', knowledgeSources: [], confidence: 0.85, images: [] },
            productContext: { productContext: '商品：智能手表Pro' },
            sizeChartContext: undefined,
            minScore: 0.75,
        });

        createStreamMock.mockReturnValue(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: {"content":"[DELEGATE_TO]child-bot-uuid","done":true}\n\n'));
                    controller.close();
                },
            }),
        );

        const res = await POST(
            buildRequest({ content: '查商品' }) as never,
            { params: Promise.resolve({ id: 'conv-1' }) },
        );

        expect(res.status).toBe(200);
        expect(delegateTaskSpy).toHaveBeenCalledTimes(1);
        const callArgs = delegateTaskSpy.mock.calls[0][0];
        // llmProviderConfig 存在时 degraded 由子 Agent 的 generateSubAgentResponse 判定
        // 缺少 baseUrl/apiKey 时 degraded=true → confidence=0.3
        expect(callArgs.llmProviderConfig).toBeDefined();
    });

    it('当无 productContext / sizeChartContext 时仍应调用 delegateTask（基线回归）', async () => {
        // 当 orchestrator 未返回 product/size-chart 上下文时
        orchestratorRetrieveMock.mockResolvedValue({
            decision: { action: 'delegate' as const, reasonCode: 'sub_agent_match' as const, effectiveQuery: '普通问题', confidence: 0.8 },
            evidence: { candidates: [], accepted: [], citations: [], trace: { provenanceVersion: 2, retrievalRan: false, rerankDegraded: false, rerankBackend: 'bge' as const, hybridSearch: false, candidateCount: 0, acceptedCount: 0, citationCount: 0, minScore: 0.75, executionTimeMs: 5, degradationReasons: [] } },
            knowledgeContext: { context: '', knowledgeSources: [], confidence: 0, images: [] },
            productContext: undefined,
            sizeChartContext: undefined,
            minScore: 0.75,
        });

        createStreamMock.mockReturnValue(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: {"content":"[DELEGATE_TO]child-bot-uuid","done":true}\n\n'));
                    controller.close();
                },
            }),
        );

        const res = await POST(
            buildRequest({ content: '普通问题' }) as never,
            { params: Promise.resolve({ id: 'conv-1' }) },
        );

        expect(res.status).toBe(200);
        expect(delegateTaskSpy).toHaveBeenCalledTimes(1);
        // 无上下文时 productContext/sizeChartContext 应为空字符串
        const callArgs = delegateTaskSpy.mock.calls[0][0];
        expect(callArgs.productContext ?? '').toBe('');
        expect(callArgs.sizeChartContext ?? '').toBe('');
    });
});

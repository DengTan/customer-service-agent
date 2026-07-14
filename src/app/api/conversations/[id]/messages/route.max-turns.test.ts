import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

// Mock content-filter so it passes through cleanly.
const filterContentMock = vi.fn(async (content: string) => ({
  allowed: true,
  filteredContent: content,
  warnings: [],
  sensitiveWordMatches: [],
}));
vi.mock('@/server/services/content-filter-service', () => ({
  ContentFilterService: class { filterContent = filterContentMock; },
}));

// Stub ALL heavy services imported by the messages route.
const ensureCanReceiveAiMessageMock = vi.fn(async () => ({ status: 'active' }));
const countUserMessagesMock = vi.fn(async () => 0);
const insertMessageMock = vi.fn(async () => {});
const updateMessageCountAfterUserMessageMock = vi.fn(async () => {});
const updateConversationMock = vi.fn(async () => {});
const getConversationBasicMock = vi.fn(async () => ({ id: 'conv-1', platform_connection_id: null }));
const incrementMessageCountMock = vi.fn(async () => {});
const listMessageHistoryMock = vi.fn(async () => []);
const getSessionInfoMock = vi.fn(async () => null);

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
  },
}));

vi.mock('@/server/services/auto-reply-service', () => ({
  AutoReplyService: class {
    matchReply = vi.fn(async () => null);
  },
}));

// LLM streaming — should NOT be invoked when max-turns blocks.
const createStreamMock = vi.fn();
vi.mock('@/server/services/llm-streaming-service', () => ({
  LLMStreamingService: class {
    createStream = createStreamMock;
  },
}));

vi.mock('@/server/services/sub-agent-service', () => ({
  SubAgentService: class {
    detectIntentAndRoute = vi.fn(async () => ({ matchedSubAgent: null, confidence: 0 }));
    delegateTask = vi.fn(async () => ({}));
  },
}));

const getSettingsMapMock = vi.fn(async () => ({}));
vi.mock('@/server/services/settings-service', () => ({
  SettingsService: class {
    getSettingsMap = getSettingsMapMock;
  },
}));

vi.mock('@/server/services/handoff-service', () => ({
  HandoffService: class {},
}));

const matchRuleMock = vi.fn(async () => null);
vi.mock('@/server/services/routing-service', () => ({
  RoutingService: class {
    matchRule = matchRuleMock;
  },
}));

const retrieveMock = vi.fn(async () => ({
  evidence: { trace: { provenanceVersion: 'v1', rerankDegraded: false }, candidates: [], citations: [] },
  decision: { action: 'accept', reasonCode: 'ok' },
  knowledgeContext: null,
  productContext: null,
  sizeChartContext: null,
  minScore: 0.75,
}));
vi.mock('@/server/services/retrieval-orchestrator', () => ({
  RetrievalOrchestrator: class {
    retrieve = retrieveMock;
  },
}));

vi.mock('@/server/repositories/bot-config-repository', () => ({
  BotConfigRepository: class {
    findByShopId = vi.fn(async () => null);
  },
}));

import { POST } from '@/app/api/conversations/[id]/messages/route';

function buildRequest(body: { content: string }): Request {
  return new Request('http://localhost/api/conversations/conv-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/conversations/[id]/messages — max_turns enforcement (phase 4)', () => {
  beforeEach(() => {
    ensureCanReceiveAiMessageMock.mockReset();
    countUserMessagesMock.mockReset();
    insertMessageMock.mockReset();
    updateMessageCountAfterUserMessageMock.mockReset();
    updateConversationMock.mockReset();
    getConversationBasicMock.mockReset();
    incrementMessageCountMock.mockReset();
    listMessageHistoryMock.mockReset();
    getSessionInfoMock.mockReset();
    filterContentMock.mockClear();
    matchRuleMock.mockReset();
    matchRuleMock.mockResolvedValue(null);
    createStreamMock.mockReset();
    getSettingsMapMock.mockReset();
    retrieveMock.mockReset();
    retrieveMock.mockResolvedValue({
      evidence: { trace: { provenanceVersion: 'v1', rerankDegraded: false }, candidates: [], citations: [] },
      decision: { action: 'accept', reasonCode: 'ok' },
      knowledgeContext: null,
      productContext: null,
      sizeChartContext: null,
      minScore: 0.75,
    });

    ensureCanReceiveAiMessageMock.mockResolvedValue({ status: 'active' });
    countUserMessagesMock.mockResolvedValue(0);
    insertMessageMock.mockResolvedValue(undefined);
    updateMessageCountAfterUserMessageMock.mockResolvedValue(undefined);
    updateConversationMock.mockResolvedValue(undefined);
    getConversationBasicMock.mockResolvedValue({ id: 'conv-1', platform_connection_id: null });
    incrementMessageCountMock.mockResolvedValue(undefined);
    listMessageHistoryMock.mockResolvedValue([]);
    getSessionInfoMock.mockResolvedValue(null);
    filterContentMock.mockImplementation(async (content: string) => ({
      allowed: true,
      filteredContent: content,
      warnings: [],
      sensitiveWordMatches: [],
    }));
    getSettingsMapMock.mockResolvedValue({});
  });

  it('rejects the (N+1)th user message when existingUserTurns === max_turns (role=user exact)', async () => {
    getSettingsMapMock.mockResolvedValue({ max_turns: '20' });
    // Exactly 20 user turns already exist (simulating 20 prior user messages).
    countUserMessagesMock.mockResolvedValue(20);

    const res = await POST(
      buildRequest({ content: '第 21 轮问题' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );
    const json = await res.json();

    // Conversation must be auto-ended.
    expect(updateConversationMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ status: 'ended' }),
    );
    // No new user message must be inserted.
    expect(insertMessageMock).not.toHaveBeenCalled();
    expect(updateMessageCountAfterUserMessageMock).not.toHaveBeenCalled();
    // LLM stream must not be invoked.
    expect(createStreamMock).not.toHaveBeenCalled();

    // Response body must say "轮" not "条消息".
    const body = JSON.stringify(json);
    expect(body).toContain('20 轮');
    expect(body).not.toContain('条消息');
  });

  it('allows the Nth user message when existingUserTurns === N-1', async () => {
    getSettingsMapMock.mockResolvedValue({ max_turns: '20' });
    countUserMessagesMock.mockResolvedValue(19);

    // Build a fake stream so the route completes.
    createStreamMock.mockReturnValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"content":"hi","done":true}\n\n'));
          controller.close();
        },
      }),
    );

    const res = await POST(
      buildRequest({ content: '第 20 轮问题' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );

    expect(res.status).toBe(200);
    // Conversation must NOT be auto-ended.
    expect(updateConversationMock).not.toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ status: 'ended' }),
    );
    // LLM stream invoked.
    expect(createStreamMock).toHaveBeenCalled();
  });

  it('max_turns=0 (or unset) means unlimited — never blocks', async () => {
    getSettingsMapMock.mockResolvedValue({});
    countUserMessagesMock.mockResolvedValue(999);

    createStreamMock.mockReturnValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"content":"hi","done":true}\n\n'));
          controller.close();
        },
      }),
    );

    const res = await POST(
      buildRequest({ content: '任何问题' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );

    expect(res.status).toBe(200);
    expect(updateConversationMock).not.toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ status: 'ended' }),
    );
  });

  it('max-turns check uses countUserMessages (role=user), not message_count which includes assistant', async () => {
    getSettingsMapMock.mockResolvedValue({ max_turns: '5' });
    // Simulate 30 total messages (15 user + 15 assistant) — but only 5 user turns exist.
    countUserMessagesMock.mockResolvedValue(5);

    const res = await POST(
      buildRequest({ content: '下一轮' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );
    const json = await res.json();

    // The (N+1)th user message at user-turn count 5 must be blocked even though
    // 30 total messages exist (15 user + 15 assistant).
    expect(updateConversationMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ status: 'ended' }),
    );
    const body = JSON.stringify(json);
    expect(body).toContain('5 轮');
  });

  it('counts role=user only — assistant/system/agent/internal_note do not count', async () => {
    // countUserMessages mock is the SOURCE OF TRUTH for the route. We assert
    // the route forwards to it instead of any sessionInfo.message_count logic.
    getSettingsMapMock.mockResolvedValue({ max_turns: '10' });
    countUserMessagesMock.mockResolvedValue(10);

    const res = await POST(
      buildRequest({ content: '第 11 轮' }) as never,
      { params: Promise.resolve({ id: 'conv-1' }) },
    );

    // The route must have consulted countUserMessages.
    expect(countUserMessagesMock).toHaveBeenCalledWith('conv-1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message?.content).toContain('10 轮');
  });
});

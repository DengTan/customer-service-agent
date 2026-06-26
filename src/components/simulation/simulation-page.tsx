'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { 
  Play, 
  Plus, 
  Trash2, 
  MessageSquare,
  Bot,
  User,
  Sparkles,
  Clock,
  XCircle,
  Send,
  FileText,
  Loader2
} from 'lucide-react';

import { SimulationConversation, SimulationMessage } from '@/lib/types';
import { logger } from '@/lib/logger';
import { useLazyList } from '@/hooks/use-lazy-list';
const simulationLogger = logger.default;

export type { SimulationConversation, SimulationMessage };

// Test scenario definitions
interface TestScenario {
  id: string;
  name: string;
  description: string;
  icon: string;
  preloaded: boolean;
}

const TEST_SCENARIOS: TestScenario[] = [
  { id: 'order_inquiry', name: '订单查询', description: '测试用户咨询订单状态、发货时间、物流进度等', icon: '📦', preloaded: false },
  { id: 'refund_request', name: '退款申请', description: '测试用户申请退款、退货的流程', icon: '💰', preloaded: false },
  { id: 'product_question', name: '产品咨询', description: '测试用户咨询产品规格、使用方法、注意事项', icon: '❓', preloaded: false },
  { id: 'complaint', name: '投诉处理', description: '测试用户投诉场景，包括情绪安抚和解决', icon: '😤', preloaded: false },
  { id: 'multi_turn', name: '多轮对话', description: '测试复杂多轮对话场景，包括上下文理解', icon: '🔄', preloaded: false },
  { id: 'custom', name: '自定义', description: '创建自定义测试脚本', icon: '✏️', preloaded: false },
];

// Preloaded test scripts
const PRELOADED_SCRIPTS: Record<string, string[]> = {
  'order_inquiry': [
    '你好，我想查一下我的订单',
    '订单号是 ORD-2024001',
    '什么时候能发货？',
    '谢谢',
  ],
  'refund_request': [
    '我申请了退款，请问什么时候能到账？',
    '已经3天了还没收到',
    '我的银行卡账号是...',
  ],
  'product_question': [
    '这个产品怎么使用？',
    '有使用说明书吗？',
    '保修期是多久？',
  ],
  'complaint': [
    '我要投诉！上次买的产品有问题',
    '等了5天了还没发货',
    '你们的服务太差了',
  ],
  'multi_turn': [
    '你好，我想买一件衣服',
    '有没有黑色的XL码？',
    '有现货吗？',
    '好的，帮我下单',
  ],
};

interface TabState {
  messages: SimulationMessage[];
  streamingContent: string;
  isLoading: boolean;
  isSending: boolean;
  scriptIndex: number;
  autoPlay: boolean;
  customScript: string[];
}

// 默认 TabState
const DEFAULT_TAB_STATE: TabState = {
  messages: [],
  streamingContent: '',
  isLoading: false,
  isSending: false,
  scriptIndex: 0,
  autoPlay: false,
  customScript: [],
};

export function SimulationPage() {
  const [scenarios] = useState<TestScenario[]>(TEST_SCENARIOS);
  const [selectedScenario, setSelectedScenario] = useState<TestScenario | null>(TEST_SCENARIOS[0] || null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});
  const abortRef = useRef<Record<string, AbortController>>({});
  const autoPlayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const loadMoreRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Lazy-loaded conversation list
  const fetchFn = useCallback(async (page: number, pageSize: number) => {
    const res = await fetch(`/api/simulations?page=${page}&limit=${pageSize}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      items: Array.isArray(data.conversations) ? data.conversations : [],
      total: data.total ?? 0,
    };
  }, []);

  const {
    items: conversations,
    total,
    hasMore,
    isInitialLoading,
    isLoadingMore,
    loadInitial,
    loadMore,
    refresh,
    updateItems,
    setTotal,
    updateItemsLength,
  } = useLazyList<SimulationConversation>({ fetchFn, pageSize: 10 });

  // Load on mount
  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Cleanup AbortControllers on unmount
  useEffect(() => {
    return () => {
      Object.values(abortRef.current).forEach((ctrl) => ctrl.abort());
    };
  }, []);

  // Stable loadMore ref for IntersectionObserver (avoids deps churn)
  loadMoreRef.current = loadMore;

  // IntersectionObserver for infinite scroll — stable useEffect pattern
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) {
          loadMoreRef.current();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore]); // loadMore is stable via ref

  // Get tab state with defaults
  const getTabState = useCallback(
    (convId: string): TabState => tabStates[convId] ?? { ...DEFAULT_TAB_STATE },
    [tabStates],
  );

  // Update tab state
  const updateTabState = useCallback((convId: string, patch: Partial<TabState>) => {
    setTabStates((prev) => ({
      ...prev,
      [convId]: { ...(prev[convId] ?? { ...DEFAULT_TAB_STATE }), ...patch },
    }));
  }, []);

  // Select a scenario (only set state, don't create conversation yet)
  const handleSelectScenario = useCallback(async (scenario: TestScenario) => {
    // Only switch scenario, create conversation when first message is sent
    setSelectedScenario(scenario);
    setActiveConvId(null);
    // Clear tab state for any previous conversation
  }, []);

  // Load messages for a conversation
  const loadMessages = useCallback(async (convId: string) => {
    updateTabState(convId, { isLoading: true });
    try {
      const res = await fetch(`/api/simulations/${convId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        updateTabState(convId, { messages: data.messages, isLoading: false });
      } else {
        updateTabState(convId, { isLoading: false });
      }
    } catch (err) {
      simulationLogger.error('加载消息失败', { error: err });
      updateTabState(convId, { isLoading: false });
    }
  }, [updateTabState]);

  // Send message (streaming) - creates conversation on first message if needed
  const handleSendMessage = useCallback(async (content: string, convId: string | null) => {
    let actualConvId: string = convId ?? '';

    // Create conversation on first message if no active conversation
    if (!convId) {
      if (!selectedScenario) {
        toast.error('请先选择一个测试场景');
        return;
      }
      try {
        const res = await fetch('/api/simulations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scenario_id: selectedScenario.id,
            scenario_name: selectedScenario.name
          }),
        });
        if (!res.ok) throw new Error('创建模拟会话失败');
        const data = await res.json();
        if (data.conversation) {
          actualConvId = data.conversation.id;
          updateItems(prev => [data.conversation, ...prev]);
          setTotal(n => n + 1);
          updateItemsLength(1); // P2-1: sync itemsLengthRef after prepend
          setActiveConvId(actualConvId);
          updateTabState(actualConvId, { ...DEFAULT_TAB_STATE });
        }
      } catch (err) {
        simulationLogger.error('创建模拟会话失败', { error: err });
        toast.error('创建模拟会话失败');
        return;
      }
    }

    const tabState = getTabState(actualConvId);
    if (tabState.isSending) return;

    const tempUserMsg: SimulationMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: actualConvId,
      role: 'user',
      content,
      sources: null,
      confidence: null,
      created_at: new Date().toISOString(),
    };

    updateTabState(actualConvId, {
      messages: [...(tabState.messages ?? []), tempUserMsg],
      isSending: true,
      streamingContent: '',
    });

    abortRef.current[actualConvId]?.abort();
    const controller = new AbortController();
    abortRef.current[actualConvId] = controller;

    try {
      const res = await fetch(`/api/simulations/${actualConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorMsg = '发送失败';
        try {
          const errData = await res.json();
          if (errData.error) errorMsg = errData.error;
        } catch { /* ignore */ }
        throw new Error(errorMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取流');

      const decoder = new TextDecoder();
      let fullContent = '';
      let lastConfidence: number | null = null;
      let lastConfidenceBreakdown: import('@/lib/types').ConfidenceBreakdown | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.content) {
                fullContent += parsed.content;
                updateTabState(actualConvId, { streamingContent: fullContent });
              }
              if (parsed.done) {
                if (parsed.confidence !== undefined) lastConfidence = parsed.confidence;
                if (parsed.confidence_breakdown) lastConfidenceBreakdown = parsed.confidence_breakdown;
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      }

      const assistantMsg: SimulationMessage = {
        id: `msg-${Date.now()}`,
        conversation_id: actualConvId,
        role: 'assistant',
        content: fullContent,
        sources: null,
        confidence: lastConfidence,
        confidence_breakdown: lastConfidenceBreakdown,
        created_at: new Date().toISOString(),
      };

      setTabStates((prev) => {
        const ts = prev[actualConvId] ?? { ...DEFAULT_TAB_STATE };
        return {
          ...prev,
          [actualConvId]: {
            ...ts,
            messages: [...ts.messages, assistantMsg],
            streamingContent: '',
            isSending: false,
          },
        };
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const ts = tabStates[actualConvId];
        if (ts?.streamingContent) {
          const partialMsg: SimulationMessage = {
            id: `msg-partial-${Date.now()}`,
            conversation_id: actualConvId,
            role: 'assistant',
            content: ts.streamingContent + '\n\n[回复超时，内容可能不完整]',
            sources: null,
            confidence: null,
            created_at: new Date().toISOString(),
          };
          setTabStates((prev) => {
            const t = prev[actualConvId] ?? { ...DEFAULT_TAB_STATE };
            return {
              ...prev,
              [actualConvId]: { ...t, messages: [...t.messages, partialMsg], streamingContent: '', isSending: false },
            };
          });
        } else {
          updateTabState(actualConvId, { isSending: false });
        }
      } else {
        simulationLogger.error('发送消息失败', { error: err });
        toast.error(String(err) || '发送失败');
        updateTabState(actualConvId, { isSending: false });
      }
    }
  }, [getTabState, updateTabState, tabStates, selectedScenario]);

  // Auto-play next script message
  const autoPlayNext = useCallback((convId: string) => {
    if (!selectedScenario) return;

    // 获取脚本：优先使用预定义脚本，其次使用自定义脚本
    const scripts = PRELOADED_SCRIPTS[selectedScenario.id] || getTabState(convId).customScript;
    if (!scripts || scripts.length === 0) return;

    const tabState = getTabState(convId);
    if (tabState.scriptIndex < scripts.length) {
      const nextMessage = scripts[tabState.scriptIndex];
      handleSendMessage(nextMessage, convId);
      updateTabState(convId, { scriptIndex: tabState.scriptIndex + 1, autoPlay: true });
    } else {
      updateTabState(convId, { autoPlay: false });
      toast.success('测试脚本执行完毕');
    }
  }, [selectedScenario, getTabState, handleSendMessage, updateTabState]);

  // Start auto-play
  const handleStartAutoPlay = useCallback((convId: string) => {
    updateTabState(convId, { scriptIndex: 0, autoPlay: true });
    // 延迟调用，让状态先更新
    setTimeout(() => autoPlayNext(convId), 0);
  }, [updateTabState, autoPlayNext]);

  // Stop auto-play
  const handleStopAutoPlay = useCallback((convId: string) => {
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    abortRef.current[convId]?.abort();
    updateTabState(convId, { autoPlay: false });
  }, [updateTabState]);

  // Clear conversation
  const handleClearConversation = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/simulations/${convId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('清除失败');
      updateItems(prev => prev.filter(c => c.id !== convId));
      setTotal(n => Math.max(0, n - 1));
      updateItemsLength(-1); // P2-1: sync itemsLengthRef after removal
      if (activeConvId === convId) {
        setActiveConvId(null);
        setSelectedScenario(TEST_SCENARIOS[0]);
      }
      // Clean up tab state to prevent memory leak
      abortRef.current[convId]?.abort();
      delete abortRef.current[convId];
      setTabStates(prev => {
        const next = { ...prev };
        delete next[convId];
        return next;
      });
      toast.success('已清除模拟记录');
    } catch (err) {
      simulationLogger.error('清除失败', { error: err });
      toast.error('清除失败');
    }
  }, [activeConvId, updateItems, setTotal, updateItemsLength]);

  // Effect to trigger auto-play after message is sent
  useEffect(() => {
    if (!activeConvId) return;
    const tabState = tabStates[activeConvId];
    if (tabState?.autoPlay && !tabState.isSending && !tabState.streamingContent && tabState.messages.length > 0) {
      const lastMsg = tabState.messages[tabState.messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        autoPlayTimerRef.current = setTimeout(() => {
          autoPlayNext(activeConvId);
        }, 1500);
      }
    }
    return () => {
      if (autoPlayTimerRef.current) {
        clearTimeout(autoPlayTimerRef.current);
      }
    };
  }, [tabStates, activeConvId, autoPlayNext]);

  const activeTabState = activeConvId ? getTabState(activeConvId) : null;
  const activeConversation = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">模拟测试</h1>
        <div className="flex items-center gap-2">
          {/* Scenario selector in header */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => handleSelectScenario(scenario)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.95] ${
                  selectedScenario?.id === scenario.id
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{scenario.icon}</span>
                <span>{scenario.name}</span>
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              try {
                const res = await fetch('/api/simulations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 
                  title: selectedScenario ? `${selectedScenario.name} - ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : `模拟会话 ${total + 1}`, 
                  scenario_id: selectedScenario?.id || null,
                  scenario_name: selectedScenario?.name || null
                }) });
                const data = await res.json();
                if (data.conversation) {
                  updateItems(prev => [data.conversation, ...prev]);
                  setTotal(n => n + 1);
                  updateItemsLength(1); // P2-1: sync itemsLengthRef after prepend
                  setActiveConvId(data.conversation.id);
                  updateTabState(data.conversation.id, { ...DEFAULT_TAB_STATE });
                }
              } catch (err) {
                simulationLogger.error('创建模拟会话失败', { error: err });
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all duration-200"
          >
            <Plus className="w-3.5 h-3.5" />
            新建会话
          </button>
        </div>
      </div>

      {/* Main Content - same layout as monitor page */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar - History list */}
        <div className="w-[300px] border-r border-border flex flex-col shrink-0 bg-card">
          {/* History Header */}
          <div className="px-4 py-2.5 border-b border-border/50">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              模拟记录
            </div>
          </div>
          {/* History List */}
          <div className="flex-1 overflow-y-auto">
            {isInitialLoading && conversations.length === 0 ? (
              <div className="px-4 py-8 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">暂无模拟记录</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  选择场景开始测试
                </p>
              </div>
            ) : (
              <div className="px-3 pb-3 space-y-1">
                {conversations.map((conv) => (
                  <div
                  key={conv.id}
                  onClick={() => {
                    setActiveConvId(conv.id);
                    setSelectedScenario(scenarios.find(s => s.id === conv.scenario_id) || null);
                    if (!tabStates[conv.id]?.messages?.length) {
                      loadMessages(conv.id);
                    }
                  }}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-all duration-150 cursor-pointer list-item-slide ${
                    activeConvId === conv.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted/50 text-foreground'
                  }`}
                >
                  <span className="text-sm">
                    {scenarios.find(s => s.id === conv.scenario_id)?.icon || '📝'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{conv.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {conv.message_count} 轮对话
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearConversation(conv.id);
                    }}
                    className="p-1 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
                {/* Load more trigger */}
                {hasMore && (
                  <div
                    ref={sentinelRef}
                    className="py-2 flex items-center justify-center"
                  >
                    {isLoadingMore ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-xs text-muted-foreground">加载更多...</span>
                    )}
                  </div>
                )}
                {!hasMore && conversations.length > 0 && (
                  <div className="py-2 text-center text-xs text-muted-foreground/50">
                    {conversations.length} 条记录，没有更多了
                  </div>
                )}
            </div>
            )}
          </div>
        </div>

        {/* Right - Chat area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {activeConvId ? (
            <>
              {/* Chat Header */}
              <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0 bg-card/50">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm">
                    {selectedScenario?.icon || '💬'}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{activeConversation?.title || selectedScenario?.name || '自由对话'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Auto-play controls - show for preloaded scripts and custom scripts */}
                  {(selectedScenario && PRELOADED_SCRIPTS[selectedScenario.id]) || (selectedScenario?.id === 'custom' && (activeTabState?.customScript?.length || 0) > 0) ? (
                    <>
                      {!activeTabState?.autoPlay ? (
                        <button
                          onClick={() => handleStartAutoPlay(activeConvId!)}
                          disabled={activeTabState?.isSending}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          自动播放
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStopAutoPlay(activeConvId!)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-error/10 text-error hover:bg-error/20 transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          停止
                        </button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {activeTabState?.scriptIndex || 0}/{
                          selectedScenario && PRELOADED_SCRIPTS[selectedScenario.id]
                            ? PRELOADED_SCRIPTS[selectedScenario.id].length
                            : (activeTabState?.customScript?.length || 0)
                        }
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Script Preview */}
              {selectedScenario && PRELOADED_SCRIPTS[selectedScenario.id] && (
                <div className="px-4 py-2 border-b border-border/50 bg-card/30">
                  <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3 h-3" />
                    测试脚本
                  </div>
                  <div className="flex items-start gap-2 overflow-x-auto pb-1">
                    {PRELOADED_SCRIPTS[selectedScenario.id].map((script, idx) => (
                      <div
                        key={idx}
                        className={`shrink-0 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200 ${
                          idx < (activeTabState?.scriptIndex || 0)
                            ? 'bg-success/10 text-success'
                            : idx === (activeTabState?.scriptIndex || 0)
                            ? 'bg-primary/10 text-primary border border-primary/30'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <span className="font-medium mr-1">{idx + 1}.</span>
                        {script}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Script Editor - show when custom scenario is selected */}
              {selectedScenario?.id === 'custom' && (
                <CustomScriptEditor
                  scripts={activeTabState?.customScript || []}
                  scriptIndex={activeTabState?.scriptIndex || 0}
                  onChange={(scripts) => {
                    if (activeConvId) {
                      updateTabState(activeConvId, { customScript: scripts, scriptIndex: 0 });
                    }
                  }}
                  disabled={activeTabState?.isSending || false}
                />
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeTabState?.messages.length === 0 && !activeTabState?.isLoading && (
                  <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
                    <Bot className="w-12 h-12 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">开始测试对话</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      输入消息或使用自动播放功能
                    </p>
                  </div>
                )}
                
                {activeTabState?.messages.map((msg, idx) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} ${
                      idx === activeTabState.messages.length - 1
                        ? msg.role === 'user' ? 'msg-enter-user' : 'msg-enter-assistant'
                        : ''
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === 'user'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-success/10 text-success'
                    }`}>
                      {msg.role === 'user' ? (
                        <User className="w-3.5 h-3.5" />
                      ) : (
                        <Bot className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className={`max-w-[70%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`rounded-2xl px-3.5 py-2.5 ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-tr-md'
                          : 'bg-muted text-foreground rounded-tl-md'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 px-1">
                        {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Streaming content */}
                {activeTabState?.streamingContent && (
                  <div className="flex gap-3 msg-enter-assistant">
                    <div className="w-7 h-7 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="max-w-[70%]">
                      <div className="bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5">
                        <p className="text-sm whitespace-pre-wrap">{activeTabState.streamingContent}</p>
                        <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-1" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Loading indicator */}
                {activeTabState?.isSending && !activeTabState?.streamingContent && (
                  <div className="flex gap-3 msg-enter-assistant">
                    <div className="w-7 h-7 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="max-w-[70%]">
                      <div className="bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          AI 正在思考...
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="p-4 border-t border-border bg-card/50 shrink-0">
                <MessageInput
                  onSend={(content) => handleSendMessage(content, activeConvId)}
                  disabled={activeTabState?.isSending || false}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">模拟测试</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                选择上方测试场景开始模拟 AI 客服在不同场景下的对话表现
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 max-w-lg">
                <div className="bg-card/50 rounded-xl p-4 text-left animate-stagger stagger-1 card-hover-lift">
                  <div className="text-2xl mb-2">📊</div>
                  <h3 className="text-sm font-medium text-foreground">效果评估</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    评估 AI 回复的准确性和专业性
                  </p>
                </div>
                <div className="bg-card/50 rounded-xl p-4 text-left animate-stagger stagger-2 card-hover-lift">
                  <div className="text-2xl mb-2">🔄</div>
                  <h3 className="text-sm font-medium text-foreground">场景覆盖</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    测试多种用户咨询场景
                  </p>
                </div>
                <div className="bg-card/50 rounded-xl p-4 text-left animate-stagger stagger-3 card-hover-lift">
                  <div className="text-2xl mb-2">⚡</div>
                  <h3 className="text-sm font-medium text-foreground">快速迭代</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    批量运行测试脚本发现问题
                  </p>
                </div>
                <div className="bg-card/50 rounded-xl p-4 text-left animate-stagger stagger-4 card-hover-lift">
                  <div className="text-2xl mb-2">📝</div>
                  <h3 className="text-sm font-medium text-foreground">测试记录</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    保存每次测试的完整对话
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Custom Script Editor Component
const MAX_CUSTOM_SCRIPTS = 15;

function CustomScriptEditor({
  scripts,
  scriptIndex,
  onChange,
  disabled,
}: {
  scripts: string[];
  scriptIndex: number;
  onChange: (scripts: string[]) => void;
  disabled: boolean;
}) {
  const [input, setInput] = useState('');
  const isMaxReached = scripts.length >= MAX_CUSTOM_SCRIPTS;

  const addScript = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (scripts.length >= MAX_CUSTOM_SCRIPTS) {
      toast.error(`自定义脚本最多支持 ${MAX_CUSTOM_SCRIPTS} 条`);
      return;
    }
    onChange([...scripts, trimmed]);
    setInput('');
  };

  const removeScript = (idx: number) => {
    onChange(scripts.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addScript();
    }
  };

  return (
    <div className="px-4 py-3 border-b border-border/50 bg-card/30">
      <div className="flex items-center gap-1.5 mb-2">
        <FileText className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">测试脚本</span>
        <span className="text-xs text-muted-foreground/50">（每行一条消息）</span>
        {scripts.length > 0 && (
          <span className="text-xs text-muted-foreground ml-2">{scripts.length}/{MAX_CUSTOM_SCRIPTS} 条</span>
        )}
      </div>

      {/* Script List */}
      {scripts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {scripts.map((script, idx) => (
            <div
              key={idx}
              className={`shrink-0 px-2.5 py-1.5 rounded-md text-xs max-w-[200px] transition-all duration-200 ${
                idx < scriptIndex
                  ? 'bg-success/10 text-success'
                  : idx === scriptIndex
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className="font-medium mr-1">{idx + 1}.</span>
              <span className="truncate">{script}</span>
              <button
                onClick={() => removeScript(idx)}
                disabled={disabled}
                className="ml-1.5 opacity-50 hover:opacity-100 disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Script Input */}
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isMaxReached ? '已达到上限（15条）' : '输入消息后按回车添加...'}
          rows={1}
          disabled={disabled || isMaxReached}
          className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none disabled:opacity-50"
          style={{ minHeight: '36px', maxHeight: '72px' }}
        />
        <button
          onClick={addScript}
          disabled={!input.trim() || disabled || isMaxReached}
          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          添加
        </button>
      </div>
    </div>
  );
}

// Message input component
function MessageInput({ onSend, disabled }: { onSend: (content: string) => void; disabled: boolean }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入测试消息..."
          rows={1}
          disabled={disabled}
          className="w-full bg-muted rounded-xl px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none disabled:opacity-50"
          style={{ minHeight: '48px', maxHeight: '120px' }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || disabled}
          className="absolute right-2 bottom-2 w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {disabled ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

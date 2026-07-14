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
  Loader2,
  GitCompare,
  Layers,
  Copy,
  BarChart3,
  ChevronDown,
  BookOpen,
  X
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

import { SimulationConversation, SimulationMessage } from '@/lib/types';
import { logger } from '@/lib/logger';
import { useLazyList } from '@/hooks/use-lazy-list';
import { SourcePanel } from '@/components/chat/source-panel';
import { SimulationEvaluationPanel } from './simulation-evaluation-panel';
import { parseSSEStream, SourceItem } from '@/lib/sse-parser';
import { BotSelector } from './bot-selector';
import { ABComparisonView, ABResult } from './ab-comparison-view';
import { BatchTestPanel, BatchResult } from './batch-test-panel';
import { BatchScriptSelector } from './batch-script-selector';
import { TEST_SCENARIOS, PRELOADED_SCRIPTS, type TestScenario } from '@/lib/simulation-scenarios';

const simulationLogger = logger.default;

export type { SimulationConversation, SimulationMessage };

// TestScenario and PRELOADED_SCRIPTS are now imported from @/lib/simulation-scenarios

// 检测 AI 回复状态的轮询间隔（毫秒）
const AI_REPLY_POLL_INTERVAL_MS = 2000;

interface TabState {
  messages: SimulationMessage[];
  streamingContent: string;
  isLoading: boolean;
  isSending: boolean;
  scriptIndex: number;
  autoPlay: boolean;
  customScript: string[];
  // AI 回复轮询状态
  isAIReplying: boolean;      // AI 是否正在回复（最后一条是 user 消息）
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
  isAIReplying: false,
};

export function SimulationPage() {
  const [scenarios] = useState<TestScenario[]>(TEST_SCENARIOS);
  const [selectedScenario, setSelectedScenario] = useState<TestScenario | null>(TEST_SCENARIOS[0] || null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});
  const [showSourcePanel, setShowSourcePanel] = useState(false);
  // Separate highlight state for button - only toggled by button click, not by message bubble click
  const [isSourcePanelHighlighted, setIsSourcePanelHighlighted] = useState(false);
  const [currentSources, setCurrentSources] = useState<SourceItem[]>([]);
  const [currentConfidence, setCurrentConfidence] = useState<number | null>(null);
  const [currentConfidenceBreakdown, setCurrentConfidenceBreakdown] = useState<{
    knowledge_score: number;
    tool_score: number;
    llm_self_score: number;
    sub_agent_score: number;
    handoff_intent: boolean;
    no_support: boolean;
    final: number;
  } | null>(null);
  // 所有带引用的消息列表（用于 SourcePanel 消息列表模式）
  const [messagesWithSources, setMessagesWithSources] = useState<{
    id: string;
    content: string;
    sources: SourceItem[];
    confidence?: number;
    confidenceBreakdown?: {
      knowledge_score: number;
      tool_score: number;
      llm_self_score: number;
      sub_agent_score: number;
      handoff_intent: boolean;
      no_support: boolean;
      final: number;
    } | null;
  }[]>([]);
  
  // Phase 5: Multi-bot comparison & batch test state
  const [showBotSelector, setShowBotSelector] = useState(false);
  const [batchTestMode, setBatchTestMode] = useState(false);
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([]);
  const [showABComparison, setShowABComparison] = useState(false);
  const [showBatchTest, setShowBatchTest] = useState(false);
  const [showBatchScriptSelector, setShowBatchScriptSelector] = useState(false);
  const [batchTestScripts, setBatchTestScripts] = useState<string[]>([]);
  
  // Bot selector for conversation creation
  const [bots, setBots] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [selectedBot, setSelectedBot] = useState<{ id: string; name: string } | null>(null);
  const [botPopoverOpen, setBotPopoverOpen] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);

  // P1: Reload bots function
  const reloadBots = useCallback(async () => {
    setBotsLoading(true);
    try {
      const res = await fetch('/api/bot-configs?include_sub_agents=false');
      if (res.ok) {
        const data = await res.json();
        const botList = Array.isArray(data.bots) ? data.bots : [];
        setBots(botList.filter((b: { status: string }) => b.status === 'active'));
      }
    } catch (err) {
      logger.error('Failed to reload bots', { error: err });
    } finally {
      setBotsLoading(false);
    }
  }, []);
  
  // Phase 3: Evaluation panel
  const [showEvaluationPanel, setShowEvaluationPanel] = useState(false);
  
  const abortRef = useRef<Record<string, AbortController>>({});
  const autoPlayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const loadMoreRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  // Tracks the active polling interval for AI replies so stale closures don't leak timers.
  const pollIntervalRef = useRef<Record<string, NodeJS.Timeout>>({});

  // SSE stream timeout: 60 seconds
  const SSE_TIMEOUT_MS = 60_000;

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
    updateItem,
    setTotal,
    updateItemsLength,
  } = useLazyList<SimulationConversation>({ fetchFn, pageSize: 10 });

  // Load on mount
  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Load bots for bot selector
  useEffect(() => {
    const loadBots = async () => {
      setBotsLoading(true);
      try {
        const res = await fetch('/api/bot-configs?include_sub_agents=false');
        if (res.ok) {
          const data = await res.json();
          const botList = Array.isArray(data.bots) ? data.bots : [];
          setBots(botList.filter((b: { status: string }) => b.status === 'active'));
        }
      } catch (err) {
        logger.error('Failed to load bots', { error: err });
      } finally {
        setBotsLoading(false);
      }
    };
    loadBots();
  }, []);

  // Cleanup AbortControllers and poll timers on unmount
  useEffect(() => {
    return () => {
      Object.values(abortRef.current).forEach((ctrl) => ctrl.abort());
      Object.values(pollIntervalRef.current).forEach((id) => clearInterval(id));
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

  // P0: Helper to refetch the persisted conversation state after a stream error/timeout
  // so the UI list and message_count match the database. When onlyCount is true, we
  // skip rewriting the in-memory message array (used for the message_count refresh path
  // after a timed-out stream where the user is still seeing the assistant bubble).
  const refreshConversationState = useCallback(async (convId: string, onlyCount = false) => {
    try {
      const res = await fetch(`/api/simulations/${convId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const messages = Array.isArray(data.messages) ? (data.messages as SimulationMessage[]) : [];
      updateItem(convId, { message_count: messages.length });
      if (!onlyCount) {
        updateTabState(convId, { messages });
      }
    } catch (err) {
      simulationLogger.warn('[SimulationPage] refreshConversationState failed', {
        error: err,
        conversationId: convId,
        onlyCount,
      });
    }
  }, [updateItem, updateTabState]);

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

    // Stop any existing polling for this convId before starting a new one.
    const existingInterval = pollIntervalRef.current[convId];
    if (existingInterval) {
      clearInterval(existingInterval);
      delete pollIntervalRef.current[convId];
    }

    try {
      const res = await fetch(`/api/simulations/${convId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        const messages = data.messages as SimulationMessage[];

        // 检测是否需要轮询等待 AI 回复
        const lastMsg = messages[messages.length - 1];
        const isAIReplying = lastMsg?.role === 'user';

        updateTabState(convId, { messages, isLoading: false, isAIReplying });

        // 如果最后一条是 user 消息，启动轮询等待 AI 回复
        if (isAIReplying) {
          const poll = () => {
            // Check the ref to see if polling should stop (stale closure safety).
            if (!pollIntervalRef.current[convId]) return;

            fetch(`/api/simulations/${convId}`)
              .then(res => res.json())
              .then(data => {
                // Guard: stop if polling was cancelled while this promise was in flight.
                if (!pollIntervalRef.current[convId]) return;
                const msgs = data.messages as SimulationMessage[];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant') {
                  clearInterval(pollIntervalRef.current[convId]);
                  delete pollIntervalRef.current[convId];
                  updateTabState(convId, {
                    messages: msgs,
                    isAIReplying: false,
                  });
                }
              })
              .catch(() => {
                // 轮询失败，静默重试
              });
          };

          // 立即执行一次，然后定期轮询
          poll();
          const intervalId = setInterval(poll, AI_REPLY_POLL_INTERVAL_MS);
          pollIntervalRef.current[convId] = intervalId;
        }
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
            scenario_name: selectedScenario.name,
            bot_id: selectedBot?.id || null,
            bot_name: selectedBot?.name || null,
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
      id: `temp-${crypto.randomUUID()}`,
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

    // SSE stream timeout: 60 seconds
    const sseTimeoutId = setTimeout(() => {
      controller.abort();
      toast.error('SSE 连接超时（60秒），请重试');
      simulationLogger.warn('[SimulationPage] SSE stream timeout', { conversationId: actualConvId });
    }, SSE_TIMEOUT_MS);

    // P0: All state below is request-local — do not read from React state inside the abort
    // handler or callbacks, because closures capture stale tabStates when a user sends multiple
    // messages in quick succession (race condition that drops assistant messages and skips
    // message_count refresh). Declarations live in the outer scope so the catch block can
    // observe them when the AbortError fires.
    let fullContent = '';
    let lastConfidence: number | null = null;
    let lastConfidenceBreakdown: import('@/lib/types').ConfidenceBreakdown | null = null;
    let lastSources: SourceItem[] = [];
    let lastMessageCount: number | null = null;
    let timedOutDone = false;
    // P0: Track server-side stream errors (e.g. catch-all in route.ts emits {error: ...})
    // so we don't silently create an empty assistant message when the backend reported failure.
    let streamErrored = false;
    let streamErrorMessage: string | null = null;

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

      await parseSSEStream(reader, (chunk) => {
        if (chunk.content) {
          fullContent += chunk.content;
          updateTabState(actualConvId, { streamingContent: fullContent });
        }
        if (chunk.error) {
          // P0: Backend signalled a stream error. Don't treat as success even if a
          // later chunk happens to look like content. The final assistant message will
          // be created from the request-local fullContent (which may be empty).
          streamErrored = true;
          streamErrorMessage = chunk.error;
          return;
        }
        if (chunk.done) {
          if (chunk.confidence !== undefined) lastConfidence = chunk.confidence;
          if (chunk.confidence_breakdown) {
            // Map generic Record to ConfidenceBreakdown type
            const bd = chunk.confidence_breakdown as Record<string, number | boolean>;
            lastConfidenceBreakdown = {
              knowledge_score: (bd.knowledge_score as number) ?? 0,
              tool_score: (bd.tool_score as number) ?? 0,
              llm_self_score: (bd.llm_self_score as number) ?? 0,
              sub_agent_score: (bd.sub_agent_score as number) ?? 0,
              handoff_intent: (bd.handoff_intent as boolean) ?? false,
              no_support: (bd.no_support as boolean) ?? false,
              final: (bd.final as number) ?? 0,
            };
          }
          if (chunk.sources) {
            // Map SSE SourceItem to SimulationMessage SourceItem (type is required)
            lastSources = (chunk.sources ?? []).map(s => ({
              type: s.type ?? 'knowledge',
              content: s.content ?? '',
              score: s.score ?? 0,
              keyword: s.keyword,
              name: s.name,
              category: s.category,
              knowledge_item_id: s.knowledge_item_id,
              item_id: s.item_id,
            }));
          }
          // Type-safe chunk reads (no `as Record<string, unknown>` casts)
          if (chunk.message_count !== undefined) lastMessageCount = chunk.message_count;
          if (chunk.timed_out === true) timedOutDone = true;
        }
      });

      clearTimeout(sseTimeoutId);

      // P0: If backend reported a stream error, surface it; the persisted user message
      // remains in the database so do NOT roll it back.
      if (streamErrored) {
        const errMsg = streamErrorMessage ?? '后端处理失败';
        simulationLogger.error('Stream error from backend', {
          error: errMsg,
          conversationId: actualConvId,
        });
        toast.error(errMsg);
        // Always refresh server-side messages/count so UI stays consistent with what was persisted.
        await refreshConversationState(actualConvId);
        updateTabState(actualConvId, { isSending: false, streamingContent: '' });
        return;
      }

      const assistantMsg: SimulationMessage = {
        id: `msg-${crypto.randomUUID()}`,
        conversation_id: actualConvId,
        role: 'assistant',
        content: fullContent,
        sources: lastSources.length > 0 ? lastSources as SimulationMessage['sources'] : null,
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

      // Update message count in conversation list from API response.
      // If the backend omitted message_count (e.g. count query failed), fall back to
      // refetching the conversation state to derive an accurate count.
      if (lastMessageCount !== null) {
        updateItem(actualConvId, { message_count: lastMessageCount });
      } else {
        // Fallback: re-read messages to compute the count rather than fabricating 0.
        await refreshConversationState(actualConvId, /*onlyCount*/ true);
      }

      // Auto-play: increment scriptIndex after successful message
      const currentTabState = tabStates[actualConvId];
      if (currentTabState?.autoPlay) {
        updateTabState(actualConvId, { scriptIndex: (currentTabState.scriptIndex ?? 0) + 1 });
      }
    } catch (err) {
      clearTimeout(sseTimeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        // P0: Use request-local fullContent (captured by closure) instead of reading
        // tabStates[actualConvId].streamingContent, which can be stale when the user
        // sends multiple messages in quick succession and races with state updates.
        const partialText = fullContent;

        if (partialText) {
          const partialMsg: SimulationMessage = {
            id: `msg-partial-${crypto.randomUUID()}`,
            conversation_id: actualConvId,
            role: 'assistant',
            content: partialText,
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
          // P0: Even with no partial content, the backend may have persisted a user message
          // and an assistant message. Refresh server-side state so the UI doesn't diverge.
          updateTabState(actualConvId, { isSending: false, streamingContent: '' });
        }

        // P0: Always refresh message count after an aborted stream, regardless of
        // whether partial content was received. Without this, the conversation list
        // can drift from the actual database state (e.g. user message persisted but
        // count not yet visible because the RPC is async).
        try {
          await refreshConversationState(actualConvId, /*onlyCount*/ true);
        } catch (refreshError) {
          simulationLogger.warn('[SimulationPage] Failed to refresh message count after timeout', {
            error: refreshError,
            conversationId: actualConvId,
          });
        }

        // Only toast if we don't already have a backend-streamed timed_out done.
        // The backend (60s SSE_TIMEOUT_MS) will emit `timed_out: true` in done and save
        // its own partial content; if that already happened before the browser-level
        // abort, the message list is already populated and we don't want to show a
        // second, conflicting timeout toast.
        if (!timedOutDone) {
          toast.error('SSE 连接超时（60秒），请重试');
          simulationLogger.warn('[SimulationPage] SSE stream timeout', { conversationId: actualConvId });
        }
      } else {
        simulationLogger.error('发送消息失败', { error: err, conversationId: actualConvId });
        const errorMessage = String(err) || '发送失败';
        if (errorMessage.includes('NO_SYSTEM_PROMPT') || errorMessage.includes('请先在 Bot 配置或系统设置中配置系统提示词')) {
          toast.error('请先配置系统提示词', {
            action: {
              label: '去设置',
              onClick: () => window.location.href = '/settings?tab=bot',
            },
          });
        } else {
          toast.error(errorMessage);
        }
        // Rollback: remove tempUserMsg and reset isSending.
        // Note: the user message may have already been persisted on the backend (the
        // route writes the user message BEFORE streaming). To keep frontend and backend
        // in sync, refresh server state instead of silently deleting the optimistic user
        // row when the API actually accepted the message.
        const looksLikeNetworkError =
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('NetworkError') ||
          errorMessage.includes('TypeError');
        if (looksLikeNetworkError) {
          // Network-level failure: backend may not have processed the request at all.
          // Safe to drop the optimistic temp user message.
          setTabStates((prev) => {
            const ts = prev[actualConvId];
            if (ts) {
              return {
                ...prev,
                [actualConvId]: {
                  ...ts,
                  messages: ts.messages.filter((m) => !m.id.startsWith('temp-')),
                  isSending: false,
                },
              };
            }
            return prev;
          });
        } else {
          // Backend reached: user message is likely persisted. Refresh server state so
          // the temp user row is replaced with the authoritative row.
          updateTabState(actualConvId, { isSending: false, streamingContent: '' });
          await refreshConversationState(actualConvId);
        }
      }
    }
  }, [getTabState, updateTabState, tabStates, selectedScenario, refreshConversationState, updateItem]);

  // Auto-play next script message
  const autoPlayNext = useCallback((convId: string) => {
    if (!selectedScenario) return;

    // 获取脚本：优先使用预定义脚本，其次使用自定义脚本
    const scripts = PRELOADED_SCRIPTS[selectedScenario.id] || getTabState(convId).customScript;
    if (!scripts || scripts.length === 0) return;

    const tabState = getTabState(convId);
    if (tabState.scriptIndex < scripts.length) {
      const nextMessage = scripts[tabState.scriptIndex];
      // Don't increment scriptIndex here - let handleSendMessage do it on success
      handleSendMessage(nextMessage, convId);
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
      
      // 清理 AI 回复轮询定时器
      const existingInterval = pollIntervalRef.current[convId];
      if (existingInterval) {
        clearInterval(existingInterval);
        delete pollIntervalRef.current[convId];
      }
      
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
  }, [activeConvId, tabStates, updateItems, setTotal, updateItemsLength]);

  // Duplicate conversation
  const handleDuplicateConversation = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/simulations/${convId}/duplicate`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '复制失败');
      }
      const data = await res.json();
      if (data.conversation) {
        updateItems(prev => [data.conversation, ...prev]);
        setTotal(n => n + 1);
        updateItemsLength(1);
        toast.success(`已复制为「${data.conversation.title}」`);
        // Auto-select the new duplicate
        setActiveConvId(data.conversation.id);
        updateTabState(data.conversation.id, { ...DEFAULT_TAB_STATE });
        // Reset source/evaluation panels when switching conversations
        setShowSourcePanel(false);
        setIsSourcePanelHighlighted(false);
        setShowEvaluationPanel(false);
        setCurrentSources([]);
        setCurrentConfidence(null);
        setCurrentConfidenceBreakdown(null);
        setMessagesWithSources([]);
      }
    } catch (err) {
      simulationLogger.error('复制会话失败', { error: err });
      toast.error(String(err) || '复制失败');
    }
  }, [updateItems, setTotal, updateItemsLength, updateTabState, setShowSourcePanel, setShowEvaluationPanel, setCurrentSources, setCurrentConfidence, setCurrentConfidenceBreakdown, setMessagesWithSources]);

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

  // Auto-scroll to bottom when messages or streaming content changes
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [tabStates, activeConvId]);

  const activeTabState = activeConvId ? getTabState(activeConvId) : null;
  const activeConversation = conversations.find((c) => c.id === activeConvId);

  // Get display title for active conversation
  const getConversationTitle = () => {
    if (activeConversation?.scenario_name) return activeConversation.scenario_name;
    if (activeConversation?.title) return activeConversation.title;
    if (selectedScenario) return selectedScenario.name;
    if (selectedBot) return selectedBot.name;
    return '模拟会话';
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">模拟测试</h1>
        <div className="flex items-center gap-2">
          {/* Bot selector - Left of scenario selector */}
          <Popover open={botPopoverOpen} onOpenChange={setBotPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={botPopoverOpen}
                className="w-[180px] h-9 text-xs gap-2 justify-start bg-muted/50 border border-transparent hover:border-border hover:bg-muted transition-all"
              >
                {selectedBot ? (
                  <>
                    <Bot className="w-3.5 h-3.5 text-primary" />
                    <span className="font-medium truncate">{selectedBot.name}</span>
                    <ChevronDown className="ml-auto w-3 h-3 text-muted-foreground" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">选择Bot</span>
                    <ChevronDown className="ml-auto w-3 h-3 text-muted-foreground" />
                  </>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
              <div className="flex flex-col max-h-[300px]">
                <div className="px-3 py-2 border-b border-border">
                  {botsLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span>加载中...</span>
                    </div>
                  ) : (
                    <div className="text-xs font-medium text-muted-foreground">
                      {bots.length > 0 ? `${bots.length} 个Bot` : '暂无Bot'}
                    </div>
                  )}
                </div>
                {!botsLoading && (
                <div className="overflow-y-auto flex-1">
                  {/* None option */}
                  <div
                    onClick={() => {
                      setSelectedBot(null);
                      setBotPopoverOpen(false);
                    }}
                    className={`relative flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${
                      !selectedBot ? 'bg-primary/5' : ''
                    }`}
                  >
                    <Bot className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">不使用Bot（通用模式）</span>
                  </div>
                  {bots.map((bot) => (
                    <div
                      key={bot.id}
                      onClick={() => {
                        setSelectedBot({ id: bot.id, name: bot.name });
                        setBotPopoverOpen(false);
                      }}
                      className={`relative flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedBot?.id === bot.id ? 'bg-primary/5' : ''
                      }`}
                    >
                      <Bot className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{bot.name}</div>
                        {bot.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{bot.description}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Scenario selector in header */}
          <Select
            value={selectedScenario?.id || ''}
            onValueChange={(value) => {
              const scenario = scenarios.find(s => s.id === value);
              if (scenario) handleSelectScenario(scenario);
            }}
          >
            <SelectTrigger className="w-[180px] h-9 text-xs gap-2 bg-muted/50 border border-transparent hover:border-border hover:bg-muted transition-all">
              <SelectValue placeholder="选择场景">
                {selectedScenario && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{selectedScenario.icon}</span>
                    <span className="font-medium truncate">{selectedScenario.name}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-[260px]" position="popper" showScrollButtons={false}>
              <div className="grid grid-cols-2 gap-1 p-1">
                {scenarios.map((scenario) => (
                  <SelectItem 
                    key={scenario.id} 
                    value={scenario.id} 
                    className="text-xs py-2 px-2 cursor-pointer rounded-lg mb-0.5 last:mb-0 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{scenario.icon}</span>
                      <span className="font-medium">{scenario.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </div>
            </SelectContent>
          </Select>
          <button
            onClick={async () => {
              try {
                const res = await fetch('/api/simulations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 
                  title: `${getConversationTitle()} - ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
                  scenario_id: selectedScenario?.id || null,
                  scenario_name: selectedScenario?.name || null,
                  bot_id: selectedBot?.id || null,
                  bot_name: selectedBot?.name || null
                }) });
                const data = await res.json();
                if (data.conversation) {
                  updateItems(prev => [data.conversation, ...prev]);
                  setTotal(n => n + 1);
                  updateItemsLength(1); // P2-1: sync itemsLengthRef after prepend
                  setActiveConvId(data.conversation.id);
                  updateTabState(data.conversation.id, { ...DEFAULT_TAB_STATE });
                  // Reset source/evaluation panels when switching conversations
                  setShowSourcePanel(false);
                  setIsSourcePanelHighlighted(false);
                  setShowEvaluationPanel(false);
                  setCurrentSources([]);
                  setCurrentConfidence(null);
                  setCurrentConfidenceBreakdown(null);
                  setMessagesWithSources([]);
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
          
          {/* Phase 5: Multi-bot comparison button */}
          <button
            onClick={() => setShowBotSelector(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-200"
          >
            <GitCompare className="w-3.5 h-3.5" />
            多Bot对比
          </button>
          
          {/* Phase 5: Batch test button */}
          <button
            onClick={() => {
              setBatchTestMode(true);
              setShowBotSelector(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-200"
          >
            <Layers className="w-3.5 h-3.5" />
            批量测试
          </button>
        </div>
      </div>

      {/* Main Content - same layout as monitor page */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar - History list */}
        <div className="w-[300px] border-r border-border flex flex-col shrink-0 bg-card">
          {/* History Header */}
          <div className="px-4 py-2.5 border-b border-border/50 mb-1">
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
                    // Sync bot selection from conversation
                    if (conv.bot_id && conv.bot_name) {
                      setSelectedBot({ id: conv.bot_id, name: conv.bot_name });
                    } else {
                      setSelectedBot(null);
                    }
                    // Reset source/evaluation panels when switching conversations
                    setShowSourcePanel(false);
                    setIsSourcePanelHighlighted(false);
                    setShowEvaluationPanel(false);
                    setCurrentSources([]);
                    setCurrentConfidence(null);
                    setCurrentConfidenceBreakdown(null);
                    setMessagesWithSources([]);
                    if (!tabStates[conv.id]?.messages?.length) {
                      loadMessages(conv.id);
                    }
                  }}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-all duration-150 cursor-pointer list-item-slide conv-item-enter ${
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
                    <div className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                      {conv.bot_name ? (
                        <>
                          <Bot className="w-3 h-3 shrink-0" />
                          <span className="truncate min-w-0">{conv.bot_name}</span>
                          <span className="text-muted-foreground/50 shrink-0">·</span>
                        </>
                      ) : null}
                      <span className="shrink-0">{conv.message_count} 条消息</span>
                      {tabStates[conv.id]?.isAIReplying && (
                        <span className="shrink-0 flex items-center gap-0.5 text-primary">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span className="text-[10px]">回复中</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateConversation(conv.id);
                      }}
                      className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      title="复制会话"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
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
              <div className="flex items-center justify-between px-4 h-12 border-b-0 shrink-0 bg-card/50">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm">
                    {selectedScenario?.icon || '💬'}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{activeConversation?.bot_name || activeConversation?.title || selectedScenario?.name || '自由对话'}</div>
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
                  {/* Source panel toggle */}
                  <button
                    onClick={() => {
                      if (isSourcePanelHighlighted) {
                        setIsSourcePanelHighlighted(false);
                        setShowSourcePanel(false);
                      } else {
                        // Get all assistant messages with sources
                        const msgsWithSources = activeTabState?.messages
                          ?.filter(m => m.role === 'assistant' && m.sources && m.sources.length > 0)
                          .map(m => ({
                            id: m.id,
                            content: m.content?.slice(0, 100) || '',
                            sources: (m.sources as SourceItem[]) || [],
                            confidence: m.confidence ?? undefined,
                            confidenceBreakdown: m.confidence_breakdown ?? null,
                          })) || [];
                        setMessagesWithSources(msgsWithSources);
                        setShowSourcePanel(true);
                        setIsSourcePanelHighlighted(true);
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      isSourcePanelHighlighted
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    }`}
                    title="引用溯源"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    引用溯源
                  </button>
                  {/* Evaluation button */}
                  <button
                    onClick={() => {
                      if (showEvaluationPanel) {
                        setShowEvaluationPanel(false);
                      } else {
                        setShowEvaluationPanel(true);
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      showEvaluationPanel
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    }`}
                    title="评估"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    评估
                  </button>
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
                        className={`shrink-0 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200 script-tag-enter ${
                          idx < (activeTabState?.scriptIndex || 0)
                            ? 'bg-success/10 text-success'
                            : idx === (activeTabState?.scriptIndex || 0)
                            ? 'bg-primary/10 text-primary border border-primary/30'
                            : 'bg-muted text-muted-foreground'
                        }`}
                        style={{ animationDelay: `${idx * 40}ms` }}
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
              <div className="flex flex-1 min-h-0">
                <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
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
                    <div className={`${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div 
                        className={`inline-block rounded-2xl px-3.5 py-2.5 cursor-pointer hover:opacity-90 max-w-[70ch] ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground rounded-tr-md'
                            : 'bg-muted text-foreground rounded-tl-md'
                        }`}
                        onClick={() => {
                          if (msg.role === 'assistant' && (msg.sources as SourceItem[])?.length) {
                            setCurrentSources((msg.sources as SourceItem[]) || []);
                            setCurrentConfidence(msg.confidence ?? null);
                            setCurrentConfidenceBreakdown(msg.confidence_breakdown ?? null);
                            // Clear messagesWithSources to show single message mode
                            setMessagesWithSources([]);
                            // Cancel button highlight but keep panel open
                            setIsSourcePanelHighlighted(false);
                            if (!showSourcePanel) {
                              setShowSourcePanel(true);
                            }
                          }
                        }}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        {/* Sources hint */}
                        {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                          <div className="mt-1.5 pt-1.5 border-t border-border/30 flex items-center gap-1 flex-wrap">
                            <BookOpen className="w-2.5 h-2.5 text-primary/80" />
                            <span className="text-[10px] text-primary/80">该消息引用溯源 ({msg.sources.length}条)</span>
                            <span className="text-[10px] text-muted-foreground/60 ml-auto">点击查看详情</span>
                          </div>
                        )}
                        {/* Confidence badge */}
                        {msg.role === 'assistant' && msg.confidence !== null && msg.confidence !== undefined && (
                          <div className={`text-[10px] font-medium ${
                            msg.confidence < 0.4 ? 'text-red-500' : msg.confidence < 0.7 ? 'text-amber-500' : 'text-emerald-500'
                          }`}>
                            置信度 {Math.round(msg.confidence * 100)}%
                          </div>
                        )}
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
                      <div className="inline-block bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5" style={{ maxWidth: '100%' }}>
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
                      <div className="inline-block bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          AI 正在思考...
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* AI 回复中状态（页面重新加载时检测到 user 消息后显示） */}
                {activeTabState?.isAIReplying && !activeTabState?.isSending && !activeTabState?.streamingContent && (
                  <div className="flex gap-3 msg-enter-assistant">
                    <div className="w-7 h-7 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="max-w-[70%]">
                      <div className="inline-block bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          AI 正在回复...
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                </div>

                {/* Source Panel - Fixed Sidebar */}
                {showSourcePanel && (
                  <SourcePanel
                    sources={currentSources}
                    confidence={currentConfidence}
                    confidenceBreakdown={currentConfidenceBreakdown}
                    messagesWithSources={messagesWithSources}
                    onClose={() => {
                      setShowSourcePanel(false);
                      setIsSourcePanelHighlighted(false);
                    }}
                  />
                )}

                {/* Evaluation Panel - Fixed Sidebar */}
                {showEvaluationPanel && (
                  <SimulationEvaluationPanel
                    simulationId={activeConvId!}
                    onSubmit={async (data) => {
                      const res = await fetch(`/api/simulations/${activeConvId}/evaluation`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data),
                      });
                      if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || '提交失败');
                      }
                    }}
                    onClose={() => setShowEvaluationPanel(false)}
                  />
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
      
      {/* Phase 5: Bot Selector Modal (Multi-bot A/B comparison or single-bot batch test) */}
      {showBotSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 bot-modal-overlay">
          <div className="bg-background rounded-xl shadow-xl w-[500px] max-h-[80vh] flex flex-col overflow-hidden bot-modal-content">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                {batchTestMode ? '选择Bot进行批量测试' : '选择Bot进行对比'}
              </h2>
              <button
                onClick={() => {
                  setShowBotSelector(false);
                  setBatchTestMode(false);
                  setSelectedBotIds([]);
                }}
                className="p-1 rounded hover:bg-muted transition-colors"
              >
                <XCircle className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <BotSelector
                selectedBotIds={selectedBotIds}
                onChange={setSelectedBotIds}
                maxSelection={batchTestMode ? 1 : 2}
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-card">
              <button
                onClick={() => {
                  setShowBotSelector(false);
                  setBatchTestMode(false);
                  setSelectedBotIds([]);
                }}
                className="px-4 py-2 rounded-lg text-sm bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (batchTestMode) {
                    if (selectedBotIds.length < 1) {
                      toast.error('请至少选择 1 个 Bot');
                      return;
                    }
                    setShowBotSelector(false);
                    setBatchTestMode(false);
                    setShowBatchScriptSelector(true);
                    return;
                  }
                  if (selectedBotIds.length < 2) {
                    toast.error('请选择至少2个Bot进行对比');
                    return;
                  }
                  // Get current scripts
                  const scripts = selectedScenario && PRELOADED_SCRIPTS[selectedScenario.id]
                    ? PRELOADED_SCRIPTS[selectedScenario.id]
                    : activeTabState?.customScript || [];
                  if (scripts.length === 0) {
                    toast.error('当前场景没有测试脚本，请先选择有脚本的场景');
                    return;
                  }
                  setShowBotSelector(false);
                  setShowABComparison(true);
                }}
                disabled={selectedBotIds.length < (batchTestMode ? 1 : 2)}
                className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {batchTestMode ? '选择脚本' : '开始对比'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Phase 5: A/B Comparison View */}
      {showABComparison && selectedBotIds.length >= 2 && (
        <ABComparisonView
          botIds={selectedBotIds}
          scripts={
            selectedScenario && PRELOADED_SCRIPTS[selectedScenario.id]
              ? PRELOADED_SCRIPTS[selectedScenario.id]
              : activeTabState?.customScript || []
          }
          onComplete={(results) => {
            toast.success('A/B测试完成');
          }}
          onClose={() => {
            setShowABComparison(false);
          }}
        />
      )}
      
      {/* Phase 5: Batch Script Selector */}
      {showBatchScriptSelector && (
        <BatchScriptSelector
          onConfirm={(scripts) => {
            setBatchTestScripts(scripts);
            setShowBatchScriptSelector(false);
            setShowBatchTest(true);
          }}
          onClose={() => {
            setShowBatchScriptSelector(false);
          }}
        />
      )}
      
      {/* Phase 5: Batch Test Panel */}
      {showBatchTest && (
        <BatchTestPanel
          scripts={batchTestScripts}
          botId={selectedBotIds[0]}
          onProgress={() => {}}
          onComplete={(results) => {
            toast.success(`批量测试完成: ${results.filter(r => r.success).length}/${results.length} 成功`);
            setSelectedBotIds([]);
          }}
          onClose={() => {
            setShowBatchTest(false);
            setSelectedBotIds([]);
          }}
        />
      )}
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
  
  const MAX_LENGTH = 2000;

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
    const value = e.target.value;
    if (value.length <= MAX_LENGTH) {
      setInput(value);
      const target = e.target;
      target.style.height = 'auto';
      target.style.height = Math.min(target.scrollHeight, 150) + 'px';
    }
  };

  const canSend = input.trim().length > 0 && !disabled;
  const isNearLimit = input.length > MAX_LENGTH * 0.8;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 relative h-12">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入测试消息...（Shift+Enter换行）"
          rows={1}
          disabled={disabled}
          className="absolute inset-0 w-full h-full bg-muted rounded-xl px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none disabled:opacity-50 transition-all border border-transparent focus:border-primary/30"
        />
        {input.length > 0 && (
          <span className={`absolute right-10 top-1/2 -translate-y-1/2 text-[10px] z-10 ${isNearLimit ? 'text-amber-500' : 'text-muted-foreground/50'}`}>
            {input.length}/{MAX_LENGTH}
          </span>
        )}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 z-20"
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

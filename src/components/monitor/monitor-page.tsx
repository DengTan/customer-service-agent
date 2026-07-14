'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import useSWR from 'swr';
import { swrConfig } from '@/lib/swr-config';
import { useVisibilityAwarePoll } from '@/hooks/use-visibility-aware-poll';
import { ConversationMonitorList } from './conversation-monitor-list';
import { ConversationDetail } from './conversation-detail';
import { StatsBar } from './stats-bar';
import { AlertBar } from './alert-bar';
import { AlertDrawer } from './alert-drawer';
import { MonitorListSkeleton, MonitorDetailSkeleton } from './monitor-skeleton';
import { useLazyList } from '@/hooks/use-lazy-list';
import type { Conversation, Message } from '@/lib/types';
import { logger } from '@/lib/logger';

interface AlertStats {
  unresolved: number;
  lowConfidence: number;
  highTurn: number;
  ticket: number;
}

interface StatusCounts {
  active?: number;
  handoff?: number;
  ended?: number;
  total?: number;
}

export function MonitorPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [alertStats, setAlertStats] = useState<AlertStats>({ unresolved: 0, lowConfidence: 0, highTurn: 0, ticket: 0 });
  const [alertDrawerOpen, setAlertDrawerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Use refs for filter/search so fetchFn stays stable
  const activeFilterRef = useRef<string | null>(null);
  const searchQueryRef = useRef<string | null>(null);
  const statusCountsRef = useRef<StatusCounts>({});

  // Stable fetchFn using refs to read current filter/search
  const fetchConversations = useCallback(async (page: number, pageSize: number) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(pageSize));
    if (activeFilterRef.current) {
      // Map UI filter to API status
      const statusMap: Record<string, string | undefined> = {
        active: 'active',
        handoff: 'handoff',
        active_ai: 'active',
        alert: undefined, // alert is priority-based, not status-based
      };
      const status = statusMap[activeFilterRef.current];
      if (status) params.set('status', status);
    }
    if (searchQueryRef.current) {
      params.set('search', searchQueryRef.current);
    }

    const res = await fetch(`/api/conversations?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Update status counts via ref (avoids setState inside fetchFn)
    if (data.statusCounts) {
      statusCountsRef.current = data.statusCounts;
    }

    return { items: data.conversations || [], total: data.total || 0 };
  }, []);

  const {
    items: conversations,
    total,
    hasMore,
    isInitialLoading,
    isLoadingMore,
    loadInitial,
    loadMore,
    reset,
    refresh,
    updateItems,
    startPolling,
    cleanup,
  } = useLazyList<Conversation>({
    fetchFn: fetchConversations,
    pageSize: 10,
  });

  // SWR cache for alert stats (refresh every 30 seconds)
  const fetcher = (url: string) => fetch(url).then((r) => r.json());
  const { data: alertStatsData, mutate: mutateAlertStats } = useSWR('/api/alerts?limit=100', fetcher, {
    ...swrConfig,
    refreshInterval: 30000,
  });

  // Update alert stats from SWR data
  useEffect(() => {
    if (alertStatsData?.alerts) {
      const alerts = alertStatsData.alerts;
      setAlertStats({
        unresolved: alerts.filter((a: { is_resolved: boolean }) => !a.is_resolved).length,
        lowConfidence: alerts.filter((a: { type: string }) => a.type === 'low_confidence').length,
        highTurn: alerts.filter((a: { type: string }) => a.type === 'high_turn_count').length,
        ticket: alerts.filter((a: { type: string }) => a.type.startsWith('ticket_')).length,
      });
    }
  }, [alertStatsData]);

  // Initial load
  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Use visibility-aware polling for conversations
  useVisibilityAwarePoll(
    () => {
      if (!isInitialLoading && conversations.length > 0) {
        refresh();
      }
    },
    5000,
    true
  );

  // Cleanup on unmount
  const cleanupRef = useRef(cleanup);
  useEffect(() => {
    cleanupRef.current = cleanup;
  }, [cleanup]);

  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []);

  // Sync statusCountsRef → state
  useEffect(() => {
    const incoming = statusCountsRef.current;
    const changed =
      incoming.active !== statusCounts.active ||
      incoming.handoff !== statusCounts.handoff ||
      incoming.ended !== statusCounts.ended ||
      incoming.total !== statusCounts.total;
    if (changed) {
      setStatusCounts(incoming);
    }
  });

  // Load messages when selection changes
  const loadMessages = useCallback(async (convId: string, silent = false) => {
    if (!silent) setIsLoadingMessages(true);
    try {
      const res = await fetch(`/api/conversations/${convId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
    } catch (err) {
      logger.error('加载消息失败', { error: err });
      if (!silent) toast.error('加载消息失败');
    } finally {
      if (!silent) setIsLoadingMessages(false);
    }
  }, []);

  const loadMessagesRef = useRef(loadMessages);
  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);

  useEffect(() => {
    if (selectedId) {
      loadMessagesRef.current(selectedId);
    } else {
      setMessages([]);
    }
  }, [selectedId]);

  // Clear unread on select
  const handleSelect = useCallback((convId: string) => {
    setSelectedId(convId);
    updateItems((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c)),
    );
  }, [updateItems]);

  // Takeover conversation
  const handleTakeover = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '坐席主动接管' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      updateItems((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, status: 'handoff', summary: data.summary ?? c.summary } : c)),
      );
      toast.success('已接管对话');
    } catch (err) {
      logger.error('接管失败', { error: err });
      toast.error('接管失败，请重试');
    }
  }, [updateItems]);

  // End conversation
  const handleEnd = useCallback(async (convId: string) => {
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ended' }),
      });
      updateItems((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, status: 'ended' } : c)),
      );
      toast.success('对话已结束');
    } catch (err) {
      logger.error('结束对话失败', { error: err });
      toast.error('结束对话失败');
    }
  }, [updateItems]);

  // Reopen conversation
  const handleReopen = useCallback(async (convId: string) => {
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      updateItems((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, status: 'active' } : c)),
      );
      toast.success('对话已重新开启');
    } catch (err) {
      logger.error('重开对话失败', { error: err });
      toast.error('重开对话失败');
    }
  }, [updateItems]);

  // Send message as agent
  const handleSendMessage = useCallback(async (convId: string, content: string) => {
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'agent',
      content,
      sources: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, role: 'agent' }),
      });
      if (!res.ok) throw new Error('发送失败');
      loadMessages(convId, true);
    } catch {
      toast.error('发送失败');
    }
  }, [loadMessages]);

  // Send internal note
  const handleSendInternalNote = useCallback(async (convId: string, content: string, mentions: string[]) => {
    const tempMsg: Message = {
      id: `temp-note-${Date.now()}`,
      role: 'internal_note',
      content,
      message_type: 'internal_note',
      mentions,
      sources: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await fetch(`/api/conversations/${convId}/internal-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mentions }),
      });
      if (!res.ok) throw new Error('发送失败');
    } catch {
      toast.error('内部备注发送失败');
    }
  }, []);

  // Create ticket
  const handleCreateTicket = useCallback(async (convId: string) => {
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;
    try {
      const res = await fetch('/api/tickets/from-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: convId,
          title: conv.title,
          category: 'other',
          priority: conv.priority === 'urgent' ? 'high' : 'medium',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`工单 ${data.ticket?.ticket_number || ''} 已创建`);
      } else if (res.status === 409) {
        toast.warning('该对话已有未关闭工单');
      } else {
        toast.error(data.error || '创建工单失败');
      }
    } catch {
      toast.error('创建工单失败');
    }
  }, [conversations]);

  // Filter click from stats bar → backend-driven filter
  const handleFilterClick = useCallback((filter: string | null) => {
    setActiveFilter(filter);
    activeFilterRef.current = filter;
    reset();
  }, [reset]);

  // Search change → backend-driven search
  const handleSearchChange = useCallback((query: string) => {
    searchQueryRef.current = query || null;
    reset();
  }, [reset]);

  // Tab change from list → backend-driven filter
  const handleTabFilterChange = useCallback((filter: string | null) => {
    activeFilterRef.current = filter;
    setActiveFilter(filter);
    reset();
  }, [reset]);

  // Manual refresh
  const handleManualRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }, [isRefreshing, refresh]);

  // Alert bar click
  const handleAlertClick = useCallback(() => {
    setAlertDrawerOpen(true);
  }, []);

  // Stats from backend statusCounts (not from local filtered list)
  const stats = {
    active: (statusCounts.active || 0) + (statusCounts.handoff || 0),
    handoff: statusCounts.handoff || 0,
    aiProcessing: statusCounts.active || 0,
    alerts: 0, // alerts are priority-based, not in statusCounts
  };

  const selectedConversation = conversations.find((c) => c.id === selectedId) || null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">对话监控</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
          <span className="text-xs text-muted-foreground border-l border-border pl-3">
            自动刷新: 5s
          </span>
        </div>
      </div>
      {/* Stats filter bar */}
      <StatsBar
        active={stats.active}
        handoff={stats.handoff}
        aiProcessing={stats.aiProcessing}
        alerts={stats.alerts}
        onFilterClick={handleFilterClick}
        activeFilter={activeFilter}
      />
      <div className="flex flex-1 min-h-0">
        {isInitialLoading ? (
          <MonitorListSkeleton count={8} />
        ) : (
          <ConversationMonitorList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={handleSelect}
            activeFilter={activeFilter}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            onSearchChange={handleSearchChange}
            onFilterChange={handleTabFilterChange}
            isInitialLoading={isInitialLoading}
            total={total}
          />
          )}
        {(isInitialLoading || (!selectedConversation && !isInitialLoading)) ? (
          <MonitorDetailSkeleton />
        ) : (
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <ConversationDetail
              conversation={selectedConversation}
              messages={messages}
              isLoading={isLoadingMessages}
              onTakeover={handleTakeover}
              onEnd={handleEnd}
              onReopen={handleReopen}
              onSendMessage={handleSendMessage}
              onSendInternalNote={handleSendInternalNote}
              onCreateTicket={handleCreateTicket}
            />
          </div>
        )}
      </div>
      <AlertBar
        unresolvedAlerts={alertStats.unresolved}
        lowConfidenceCount={alertStats.lowConfidence}
        highTurnCount={alertStats.highTurn}
        ticketAlertCount={alertStats.ticket}
        onClick={handleAlertClick}
      />
      <AlertDrawer open={alertDrawerOpen} onOpenChange={setAlertDrawerOpen} onAlertResolved={() => mutateAlertStats()} onConversationClick={(id) => { setSelectedId(id); setAlertDrawerOpen(false); }} />
    </div>
  );
}

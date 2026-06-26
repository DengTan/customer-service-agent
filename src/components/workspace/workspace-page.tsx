'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  MessageSquare,
  Clock,
  UserCheck,
  CheckCircle,
  RefreshCw,
  StickyNote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  AgentQueueItem,
  AgentPerformance,
  AgentStatus,
} from '@/lib/types';
import {
  AGENT_STATUS_LABELS,
  AGENT_STATUS_COLORS,
} from '@/lib/types';
import {
  type ChatMessage,
  POLL_INTERVAL_MS,
  StatCard,
} from './workspace-shared';
import { QueuePanel } from './queue-panel';
import { ChatPanel } from './chat-panel';
import { CustomerInfoPanel } from './customer-info-panel';
import { QuickRepliesPanel } from '@/components/quick-replies/quick-replies-panel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function WorkspacePage() {
  // State
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('online');
  const [queuedItems, setQueuedItems] = useState<AgentQueueItem[]>([]);
  const [assignedItems, setAssignedItems] = useState<AgentQueueItem[]>([]);
  const [queuedTotal, setQueuedTotal] = useState(0);
  const [assignedTotal, setAssignedTotal] = useState(0);
  const [isLoadingMoreQueued, setIsLoadingMoreQueued] = useState(false);
  const [isLoadingMoreAssigned, setIsLoadingMoreAssigned] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<AgentQueueItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [performance, setPerformance] = useState<AgentPerformance | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const { user } = useAuth();

  // Refs for tracking loaded counts (avoid closure staleness)
  const queuedItemsLengthRef = useRef(0);
  const assignedItemsLengthRef = useRef(0);

  // Fetch data with pagination support
  const fetchData = useCallback(async (mode: 'refresh' | 'load-queued' | 'load-assigned' = 'refresh') => {
    try {
      if (mode === 'refresh') {
        // Refresh: load all currently-visible items + performance
        const queuedLimit = Math.max(queuedItemsLengthRef.current, 10);
        const assignedLimit = Math.max(assignedItemsLengthRef.current, 10);
        const [queueRes, assignedRes, perfRes] = await Promise.all([
          fetch(`/api/agent/queue?status=queued&limit=${queuedLimit}`),
          fetch(`/api/agent/queue?status=assigned&agent_id=${user?.id || ''}&limit=${assignedLimit}`),
          fetch('/api/agent/performance'),
        ]);

        if (queueRes.ok) {
          const qData = await queueRes.json();
          setQueuedItems(qData.items || []);
          setQueuedTotal(qData.total ?? (qData.items || []).length);
          queuedItemsLengthRef.current = (qData.items || []).length;
        }
        if (assignedRes.ok) {
          const aData = await assignedRes.json();
          setAssignedItems(aData.items || []);
          setAssignedTotal(aData.total ?? (aData.items || []).length);
          assignedItemsLengthRef.current = (aData.items || []).length;
          return aData.items || []; // Return for auto-select
        }
        if (perfRes.ok) {
          const pData = await perfRes.json();
          setPerformance(pData.performance);
        }
      } else if (mode === 'load-queued') {
        setIsLoadingMoreQueued(true);
        const offset = queuedItemsLengthRef.current;
        const res = await fetch(`/api/agent/queue?status=queued&limit=10&offset=${offset}`);
        if (res.ok) {
          const data = await res.json();
          const newItems = data.items || [];
          setQueuedItems(prev => [...prev, ...newItems]);
          setQueuedTotal(data.total ?? 0);
          queuedItemsLengthRef.current += newItems.length;
        }
        setIsLoadingMoreQueued(false);
      } else if (mode === 'load-assigned') {
        setIsLoadingMoreAssigned(true);
        const offset = assignedItemsLengthRef.current;
        const res = await fetch(`/api/agent/queue?status=assigned&agent_id=${user?.id || ''}&limit=10&offset=${offset}`);
        if (res.ok) {
          const data = await res.json();
          const newItems = data.items || [];
          setAssignedItems(prev => [...prev, ...newItems]);
          setAssignedTotal(data.total ?? 0);
          assignedItemsLengthRef.current += newItems.length;
        }
        setIsLoadingMoreAssigned(false);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
    return [];
  }, [user?.id]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/users?role=agent&status=active');
      if (res.ok) {
        const data = await res.json();
        setAgents(
          (data.users || [])
            .filter((u: { id: string }) => u.id !== user?.id)
            .map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))
        );
      }
    } catch {
      toast.error('获取坐席列表失败');
    }
  }, []);

  // Load conversation messages
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        const convMessages = (data.messages || []).map((m: { id: string; role: string; content: string; created_at: string; message_type?: string; author_name?: string; mentions?: string[] }) => ({
          id: m.id,
          role: m.message_type === 'internal_note' ? 'internal_note' : ((m.role === 'assistant' || m.role === 'agent') ? 'agent' : 'user'),
          content: m.content,
          timestamp: m.created_at,
          author_name: m.author_name,
          mentions: m.mentions || [],
        }));
        setMessages(convMessages);
      }
    } catch {
      toast.error('加载消息失败');
    }
  }, []);

  // Initial fetch + auto-select + polling
  const fetchingRef = useRef(false);
  useEffect(() => {
    const doFetch = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const items = await fetchData('refresh');
        // Auto-select first assigned conversation on initial load
        if (items.length > 0 && !selectedConversation) {
          setSelectedConversation(items[0]);
        }
      } finally {
        fetchingRef.current = false;
      }
    };
    doFetch();
    fetchAgents();
    const interval = setInterval(() => fetchData('refresh'), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.conversation_id);
    }
  }, [selectedConversation?.conversation_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh handler
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchData('refresh'), fetchAgents()]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleStatusChange = async (status: AgentStatus) => {
    try {
      const res = await fetch('/api/agent/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user?.id, status }),
      });
      if (res.ok) setAgentStatus(status);
      else toast.error('切换状态失败');
    } catch {
      toast.error('切换状态失败');
    }
  };

  const handleClaim = async (queueId: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_id: queueId, agent_id: user?.id }),
      });
      if (res.ok) {
        await fetchData('refresh');
      } else {
        toast.error('接单失败');
      }
    } catch {
      toast.error('接单失败');
    }
    setLoading(false);
  };

  const handleResolve = async (queueId: string) => {
    try {
      const res = await fetch('/api/agent/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_id: queueId, action: 'resolve' }),
      });
      if (res.ok) {
        setSelectedConversation(null);
        setMessages([]);
        await fetchData('refresh');
      } else {
        toast.error('操作失败');
      }
    } catch {
      toast.error('操作失败');
    }
  };

  const handleTransferComplete = () => {
    setSelectedConversation(null);
    setMessages([]);
    fetchData('refresh');
  };

  const formatResponseTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}分${s}秒`;
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">坐席工作台</h1>
        {/* Stats */}
        <div className="flex items-center gap-4">
          <StatCard
            icon={<Clock className="w-4 h-4 text-amber-500" />}
            label="排队中"
            value={queuedTotal.toString()}
          />
          <StatCard
            icon={<MessageSquare className="w-4 h-4 text-primary" />}
            label="服务中"
            value={assignedTotal.toString()}
          />
          <StatCard
            icon={<CheckCircle className="w-4 h-4 text-emerald-500" />}
            label="今日已解决"
            value={performance?.total_resolved?.toString() || '0'}
          />
          <StatCard
            icon={<UserCheck className="w-4 h-4 text-muted-foreground" />}
            label="平均响应"
            value={performance?.avg_response_time_seconds ? formatResponseTime(performance.avg_response_time_seconds) : '--'}
          />
        </div>
        {/* Current Agent & Status */}
        <div className="flex items-center gap-4">
          {/* Quick Replies Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setQuickRepliesOpen(true)}
            className="gap-1.5 px-3 h-8 text-xs font-medium"
          >
            <StickyNote className="w-4 h-4" />
            话术库
          </Button>
          {/* Status Switcher */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            {(['online', 'away', 'offline'] as AgentStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  agentStatus === s
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${AGENT_STATUS_COLORS[s]}`} />
                {AGENT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {/* Refresh Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2 text-muted-foreground hover:text-foreground"
            title="刷新数据"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            {refreshing ? '刷新中...' : '刷新'}
          </Button>
        </div>
      </div>

      {/* Main Content - 3 columns */}
      <div className="flex flex-1 min-h-0">
        {/* Left Column - Queue */}
        <QueuePanel
          queuedItems={queuedItems}
          assignedItems={assignedItems}
          queuedTotal={queuedTotal}
          assignedTotal={assignedTotal}
          isLoadingMoreQueued={isLoadingMoreQueued}
          isLoadingMoreAssigned={isLoadingMoreAssigned}
          onLoadMoreQueued={() => fetchData('load-queued')}
          onLoadMoreAssigned={() => fetchData('load-assigned')}
          selectedConversation={selectedConversation}
          loading={loading}
          onSelectConversation={setSelectedConversation}
          onClaim={handleClaim}
        />

        {/* Middle Column - Chat */}
        <ChatPanel
          selectedConversation={selectedConversation}
          messages={messages}
          setMessages={setMessages}
          agents={agents}
          onTransfer={handleTransferComplete}
          onResolve={handleResolve}
        />

        {/* Right Column - Customer Info */}
        <CustomerInfoPanel
          selectedConversation={selectedConversation}
          onTransfer={handleTransferComplete}
          onResolve={handleResolve}
        />
      </div>

      {/* Quick Replies Dialog */}
      <Dialog open={quickRepliesOpen} onOpenChange={setQuickRepliesOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>话术库管理</DialogTitle>
          </DialogHeader>
          <QuickRepliesPanel className="flex-1 overflow-hidden" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

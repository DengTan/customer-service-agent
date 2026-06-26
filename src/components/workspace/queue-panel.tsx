'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { AgentQueueItem, QueuePriority } from '@/lib/types';
import { PRIORITY_LABELS, SOURCE_PLATFORM_LABELS } from '@/lib/types';
import { NOW_REFRESH_INTERVAL_MS } from './workspace-shared';

interface QueuePanelProps {
  queuedItems: AgentQueueItem[];
  assignedItems: AgentQueueItem[];
  queuedTotal: number;
  assignedTotal: number;
  isLoadingMoreQueued: boolean;
  isLoadingMoreAssigned: boolean;
  onLoadMoreQueued: () => Promise<void>;
  onLoadMoreAssigned: () => Promise<void>;
  selectedConversation: AgentQueueItem | null;
  loading: boolean;
  onSelectConversation: (item: AgentQueueItem | null) => void;
  onClaim: (queueId: string) => void;
}

export function QueuePanel({
  queuedItems,
  assignedItems,
  queuedTotal,
  assignedTotal,
  isLoadingMoreQueued,
  isLoadingMoreAssigned,
  onLoadMoreQueued,
  onLoadMoreAssigned,
  selectedConversation,
  loading,
  onSelectConversation,
  onClaim,
}: QueuePanelProps) {
  // Format wait time
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const formatWaitTime = useCallback((createdAt: string) => {
    const diff = now - new Date(createdAt).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟`;
    return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
  }, [now]);

  const [queuedExpanded, setQueuedExpanded] = useState(true);
  const [servingExpanded, setServingExpanded] = useState(true);

  const hasMoreQueued = queuedItems.length < queuedTotal;
  const hasMoreAssigned = assignedItems.length < assignedTotal;

  return (
    <div className="w-[300px] border-r border-border bg-card flex flex-col overflow-y-auto shrink-0">
      {/* Queued */}
      <div className="border-b">
        <button
          className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-muted/50"
          onClick={() => setQueuedExpanded(!queuedExpanded)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">排队等待</span>
            <Badge variant="secondary" className="text-xs px-1.5">
              {queuedItems.length}/{queuedTotal}
            </Badge>
          </div>
          {queuedExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {queuedExpanded && (
          <div className="px-2 pb-2 space-y-1">
            {queuedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">暂无排队</p>
            ) : (
              queuedItems.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">
                      {item.customer_name || '未知客户'}
                    </span>
                    <Badge
                      variant={item.priority === 'urgent' ? 'destructive' : 'secondary'}
                      className="text-xs px-1.5"
                    >
                      {PRIORITY_LABELS[item.priority as QueuePriority] || '普通'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      已等待 {formatWaitTime(item.created_at)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={() => onClaim(item.id)}
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : '接单'}
                    </Button>
                  </div>
                  {item.source_platform && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      来自 {SOURCE_PLATFORM_LABELS[item.source_platform as keyof typeof SOURCE_PLATFORM_LABELS] || item.source_platform}
                    </span>
                  )}
                </div>
              ))
            )}
            {/* Load more queued */}
            {hasMoreQueued && (
              <div className="pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={onLoadMoreQueued}
                  disabled={isLoadingMoreQueued}
                >
                  {isLoadingMoreQueued ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : null}
                  查看更多 {queuedTotal - queuedItems.length} 条
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Serving */}
      <div className="flex-1">
        <button
          className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-muted/50"
          onClick={() => setServingExpanded(!servingExpanded)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">正在服务</span>
            <Badge variant="secondary" className="text-xs px-1.5">
              {assignedItems.length}/{assignedTotal}
            </Badge>
          </div>
          {servingExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {servingExpanded && (
          <div className="px-2 pb-2 space-y-1">
            {assignedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">暂无服务中对话</p>
            ) : (
              assignedItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-2.5 rounded-lg cursor-pointer transition-colors ${
                    selectedConversation?.id === item.id
                      ? 'bg-primary/10'
                      : 'bg-muted/30 hover:bg-muted/50'
                  }`}
                  onClick={() => onSelectConversation(item)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-sm font-medium truncate">
                      {item.customer_name || '未知客户'}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    服务中 {formatWaitTime(item.assigned_at || item.created_at)}
                  </span>
                </div>
              ))
            )}
            {/* Load more assigned */}
            {hasMoreAssigned && (
              <div className="pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={onLoadMoreAssigned}
                  disabled={isLoadingMoreAssigned}
                >
                  {isLoadingMoreAssigned ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : null}
                  查看更多 {assignedTotal - assignedItems.length} 条
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

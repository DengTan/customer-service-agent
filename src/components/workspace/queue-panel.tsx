'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import type { AgentQueueItem, QueuePriority } from '@/lib/types';
import { PRIORITY_LABELS, SOURCE_PLATFORM_LABELS } from '@/lib/types';
import { NOW_REFRESH_INTERVAL_MS } from './workspace-shared';

type QueueTab = 'queued' | 'assigned';

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
  const [activeTab, setActiveTab] = useState<QueueTab>('assigned');
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

  const hasMoreQueued = queuedItems.length < queuedTotal;
  const hasMoreAssigned = assignedItems.length < assignedTotal;

  const currentItems = activeTab === 'queued' ? queuedItems : assignedItems;
  const currentTotal = activeTab === 'queued' ? queuedTotal : assignedTotal;
  const isLoadingMore = activeTab === 'queued' ? isLoadingMoreQueued : isLoadingMoreAssigned;
  const onLoadMore = activeTab === 'queued' ? onLoadMoreQueued : onLoadMoreAssigned;

  return (
    <div className="w-[280px] border-r border-border bg-card flex flex-col shrink-0">
      {/* Tab Switcher */}
      <div className="flex border-b border-border">
        <button
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'assigned'
              ? 'text-primary border-b-2 border-primary -mb-px'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('assigned')}
        >
          <span>正在服务</span>
          <Badge variant="secondary" className="text-xs">{assignedItems.length}/{assignedTotal}</Badge>
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'queued'
              ? 'text-primary border-b-2 border-primary -mb-px'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('queued')}
        >
          <span>排队等待</span>
          <Badge variant="secondary" className="text-xs">{queuedItems.length}/{queuedTotal}</Badge>
        </button>
      </div>

      {/* List Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {currentItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            {activeTab === 'assigned' ? '暂无服务中对话' : '暂无排队'}
          </p>
        ) : (
          currentItems.map((item) => {
            const isAssignedTab = activeTab === 'assigned';
            const isSelected = selectedConversation?.id === item.id;

            return isAssignedTab ? (
              <div
                key={item.id}
                className={`p-3 rounded-lg transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary/5 border-l-[3px] border-primary'
                    : 'bg-muted/30 hover:bg-muted/50 border-l-[3px] border-transparent'
                }`}
                onClick={() => onSelectConversation(item)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {item.customer_name || '未知客户'}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  服务中 {formatWaitTime(item.assigned_at || item.created_at)}
                </span>
              </div>
            ) : (
              <div
                key={item.id}
                className={`p-3 rounded-lg transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary/5 border-l-[3px] border-primary'
                    : 'bg-muted/30 hover:bg-muted/50 border-l-[3px] border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate">
                    {item.customer_name || '未知客户'}
                  </span>
                  <Badge
                    variant={item.priority === 'urgent' ? 'destructive' : 'secondary'}
                    className="text-xs shrink-0 ml-2"
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
                    className="h-6 text-xs px-2 shrink-0 ml-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClaim(item.id);
                    }}
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
            );
          })
        )}

        {/* Load More */}
        {(activeTab === 'queued' ? hasMoreQueued : hasMoreAssigned) && (
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
              查看更多 {currentTotal - currentItems.length} 条
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import Image from 'next/image';
import { Search, Globe, ImageIcon, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import type { Conversation } from '@/lib/types';

type FilterType = 'all' | 'active_ai' | 'handoff' | 'ended';

interface ConversationMonitorListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  activeFilter: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => Promise<void>;
  onSearchChange: (query: string) => void;
  onFilterChange: (filter: string | null) => void;
  isInitialLoading: boolean;
  total: number;
}

const SOURCE_ICONS: Record<string, { icon: string; color: string }> = {
  '千牛': { icon: '🔵', color: 'text-blue-600' },
  '抖店': { icon: '🟢', color: 'text-emerald-600' },
  'Web': { icon: '⚪', color: 'text-gray-500' },
};

export function ConversationMonitorList({
  conversations,
  selectedId,
  onSelect,
  activeFilter,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onSearchChange,
  onFilterChange,
  isInitialLoading,
  total,
}: ConversationMonitorListProps) {
  const [search, setSearch] = useState('');
  // P3-2: filter derived from prop — no duplicate local state needed
  const tabFilter: FilterType = !activeFilter ? 'all'
    : activeFilter === 'active' ? 'active_ai'
    : activeFilter === 'handoff' ? 'handoff'
    : activeFilter === 'ended' ? 'ended'
    : 'all';
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to top when loading completes (initial load or filter reset)
  const wasInitialLoadingRef = useRef(false);
  useLayoutEffect(() => {
    if (wasInitialLoadingRef.current && !isInitialLoading && conversations.length > 0) {
      scrollContainerRef.current?.scrollTo({ top: 0 });
    }
    wasInitialLoadingRef.current = isInitialLoading;
  }, [isInitialLoading, conversations.length]);

  // Debounced search → backend
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      onSearchChange(value);
    }, 300);
  }, [onSearchChange]);

  // Tab filter change → backend (no setFilter — tabFilter derives from prop)
  const handleFilterChange = useCallback((newFilter: FilterType) => {
    // Map local tab filter to backend status filter
    if (newFilter === 'all') {
      onFilterChange(null);
    } else if (newFilter === 'active_ai') {
      onFilterChange('active');
    } else if (newFilter === 'handoff') {
      onFilterChange('handoff');
    } else if (newFilter === 'ended') {
      onFilterChange('ended');
    }
  }, [onFilterChange]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  // Trust backend-filtered results, only apply local activeFilter for alert priority
  const filtered = activeFilter === 'alert'
    ? conversations.filter((c) => c.priority === 'urgent')
    : conversations;

  // Sort: newest first by created_at (conversation creation time)
  const sorted = [...filtered].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}小时前`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  const getStatusLabel = (conv: Conversation) => {
    if (conv.status === 'ended') return { label: '已结束', color: 'bg-muted text-muted-foreground' };
    if (conv.status === 'handoff') return { label: '人工处理中', color: 'bg-primary/10 text-primary' };
    return { label: 'AI处理中', color: 'bg-emerald-500/10 text-emerald-600' };
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'active_ai', label: 'AI处理中' },
    { key: 'handoff', label: '人工处理中' },
    { key: 'ended', label: '已结束' },
  ];

  return (
    <div className="w-[300px] border-r border-border bg-card flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索对话..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => handleFilterChange(f.key)}
              className={`px-2 py-1 rounded-sm text-xs font-medium transition-all duration-200 ${
                tabFilter === f.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {isInitialLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <Globe className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
            {search ? '未找到匹配的对话' : '暂无平台对话'}
          </div>
        ) : (
          sorted.map((conv) => {
            const isActive = selectedId === conv.id;
            const status = getStatusLabel(conv);
            const sourceInfo = conv.source ? SOURCE_ICONS[conv.source] : null;
            const unread = conv.unread_count ?? 0;

            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`w-full text-left px-3 py-2.5 transition-all duration-200 flex items-start gap-2.5 relative ${
                  isActive
                    ? 'bg-primary/5 border-l-2 border-l-primary'
                    : 'border-l-2 border-l-transparent hover:bg-muted/50'
                }`}
              >
                {/* Avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 overflow-hidden ${
                  conv.status === 'ended'
                    ? 'bg-muted text-muted-foreground'
                    : conv.status === 'handoff'
                    ? 'bg-amber-500/15 text-amber-600'
                    : 'bg-emerald-500/10 text-emerald-600'
                }`}>
                  {conv.customer?.avatar ? (
                    <Image
                      src={conv.customer.avatar}
                      alt={conv.customer.name || '用户头像'}
                      width={36}
                      height={36}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    (conv.customer?.name || conv.title).charAt(0)
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {conv.priority === 'urgent' && (
                      <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                    )}
                    <span className="text-sm font-medium text-foreground truncate">
                      {conv.customer?.name || conv.title}
                    </span>
                    {unread > 0 && (
                      <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-error text-white text-[10px] font-medium px-1 shrink-0">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </div>

                  {/* Last message preview */}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {conv.last_message_image && (
                      <ImageIcon className="w-3 h-3 text-primary/60 shrink-0" />
                    )}
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {conv.last_message || `${conv.message_count} 条消息`}
                    </span>
                  </div>

                  {/* Summary for handoff */}
                  {conv.status === 'handoff' && conv.summary && (
                    <div className="flex items-start gap-1 mt-1">
                      <FileText className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                      <span className="text-[11px] text-foreground/70 leading-tight line-clamp-2">
                        {conv.summary}
                      </span>
                    </div>
                  )}

                  {/* Bottom row */}
                  <div className="flex items-center gap-1.5 mt-1">
                    {sourceInfo && (
                      <span className="text-[10px]">{sourceInfo.icon}</span>
                    )}
                    {conv.source && (
                      <span className={`text-[10px] font-medium ${sourceInfo?.color || 'text-muted-foreground'}`}>
                        {conv.source}
                      </span>
                    )}
                    <span className={`inline-flex items-center px-1.5 py-0 rounded-sm text-[10px] font-medium ${status.color}`}>
                      {status.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {formatTime(conv.created_at)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}

        {/* Sentinel for infinite scroll */}
        {hasMore && !isInitialLoading && (
          <div ref={sentinelRef} className="py-2" />
        )}

        {/* Loading more indicator */}
        {isLoadingMore && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">加载中...</span>
          </div>
        )}

        {/* End of list indicator */}
        {!hasMore && sorted.length > 0 && total > 0 && (
          <div className="py-2 text-center text-xs text-muted-foreground">
            已加载全部 {total} 条对话
          </div>
        )}
      </div>
    </div>
  );
}

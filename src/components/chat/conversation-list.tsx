'use client';

import Image from 'next/image';
import { Search, Plus, LayoutList, Headphones, FileText, ImageIcon } from 'lucide-react';
import { useState } from 'react';
import type { Conversation } from './chat-page';

interface ConversationListProps {
  conversations: Conversation[];
  openTabIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

type FilterType = 'all' | 'active' | 'ended' | 'handoff';

export function ConversationList({ conversations, openTabIds, activeId, onSelect, onNew }: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  const filtered = conversations.filter((c) => {
    // Search filter
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    // Status filter
    if (filter === 'active' && c.status !== 'active') return false;
    if (filter === 'ended' && c.status !== 'ended') return false;
    if (filter === 'handoff' && c.status !== 'handoff') return false;
    return true;
  });

  // Sort: urgent first, then by updated_at desc
  const sorted = [...filtered].sort((a, b) => {
    // Urgent first
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
    // Then by unread
    if ((a.unread_count ?? 0) > 0 && (b.unread_count ?? 0) === 0) return -1;
    if ((a.unread_count ?? 0) === 0 && (b.unread_count ?? 0) > 0) return 1;
    // Then by updated_at / created_at desc
    const dateA = a.updated_at || a.created_at;
    const dateB = b.updated_at || b.created_at;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
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

  const getInitial = (title: string) => {
    return title.charAt(0);
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '进行中' },
    { key: 'handoff', label: '待接管' },
    { key: 'ended', label: '已结束' },
  ];

  return (
    <div className="w-[280px] border-r border-border bg-card flex flex-col shrink-0 overflow-hidden">
      {/* Header: search + new button */}
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索对话..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={onNew}
            className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 active:scale-[0.97] transition-all shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            新建
          </button>
        </div>
        {/* Filter tabs */}
        <div className="flex gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-all duration-200 ${
                filter === f.key
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {sorted.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {search ? '未找到匹配的对话' : '暂无对话'}
          </div>
        ) : (
          sorted.map((conv) => {
            const isOpen = openTabIds.includes(conv.id);
            const isActive = activeId === conv.id;
            const isUrgent = conv.priority === 'urgent';
            const unread = conv.unread_count ?? 0;

            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`w-full text-left px-3 py-2.5 transition-all duration-200 flex items-start gap-2.5 relative list-item-slide ${
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
                    ? 'bg-warning/15 text-warning'
                    : 'bg-primary/10 text-primary'
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
                    getInitial(conv.customer?.name || conv.title)
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {/* Priority indicator */}
                      {isUrgent && (
                        <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" />
                      )}
                      <span className="text-sm font-medium text-foreground truncate">
                        {conv.customer?.name || conv.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Open tab indicator */}
                      {isOpen && (
                        <LayoutList className="w-3 h-3 text-primary/60" />
                      )}
                      {/* Unread badge */}
                      {unread > 0 && (
                        <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-error text-white text-[10px] font-medium px-1 animate-scale-in">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
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

                  {/* Summary preview for handoff conversations */}
                  {conv.status === 'handoff' && (conv as { summary?: string | null }).summary && (
                    <div className="flex items-start gap-1 mt-1">
                      <FileText className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                      <span className="text-[11px] text-foreground/70 leading-tight line-clamp-2">
                        {(conv as { summary?: string | null }).summary}
                      </span>
                    </div>
                  )}

                  {/* Bottom row: source + time */}
                  <div className="flex items-center gap-1.5 mt-1">
                    {/* Source tag */}
                    {conv.source && (
                      <span className={`inline-flex items-center px-1.5 py-0 rounded-sm text-[10px] font-medium ${
                        conv.source === '千牛'
                          ? 'bg-primary/10 text-primary'
                          : conv.source === '抖店'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-success/10 text-success'
                      }`}>
                        {conv.source}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatTime(conv.created_at)}
                    </span>
                    {conv.status === 'handoff' && (
                      <span className="text-[10px] text-warning font-medium">
                        · 待接管
                      </span>
                    )}
                    {conv.status === 'ended' && (
                      <span className="text-[10px] text-muted-foreground">
                        · 已结束
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

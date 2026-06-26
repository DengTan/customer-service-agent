'use client';

import { X } from 'lucide-react';
import { useRef, useEffect } from 'react';

export interface OpenTab {
  id: string;
  title: string;
  source?: string;
  priority?: 'urgent' | 'normal';
  status?: 'active' | 'ended' | 'handoff';
}

interface ChatTabBarProps {
  tabs: OpenTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function ChatTabBar({ tabs, activeId, onSelect, onClose }: ChatTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector(`[data-tab-id="${activeId}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeId]);

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center h-11 border-b border-border bg-card shrink-0">
      <div
        ref={scrollRef}
        className="flex items-center overflow-x-auto scrollbar-none flex-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`group flex items-center gap-2 px-4 h-full cursor-pointer border-r border-border shrink-0 transition-all duration-200 ${
                isActive
                  ? 'bg-background text-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted/50'
              }`}
              onClick={() => onSelect(tab.id)}
              title={tab.title}
            >
              {/* Priority dot */}
              {tab.priority === 'urgent' && (
                <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" />
              )}
              {/* Source tag */}
              {tab.source && (
                <span className={`text-[9px] px-1 py-0 rounded-sm font-medium shrink-0 ${
                  tab.source === '千牛'
                    ? 'bg-primary/10 text-primary'
                    : tab.source === '抖店'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-success/10 text-success'
                }`}>
                  {tab.source}
                </span>
              )}
              <span className="text-sm font-medium truncate max-w-[120px]">
                {tab.title}
              </span>
              {tab.status === 'ended' && (
                <span className="text-[10px] text-muted-foreground shrink-0">已结束</span>
              )}
              {/* Close button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="w-5 h-5 flex items-center justify-center rounded-sm text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

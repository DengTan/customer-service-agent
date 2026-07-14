'use client';

import { cn } from '@/lib/utils';

/** Polished skeleton for a single conversation row in the monitor list */
function MonitorConversationSkeleton() {
  return (
    <div className="flex gap-3 p-3 rounded-lg border bg-card animate-skeleton-pulse">
      {/* Avatar */}
      <div className="w-9 h-9 rounded-full bg-muted shrink-0" />

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 bg-muted rounded" />
          <div className="w-5 h-5 rounded-full bg-muted" />
        </div>
        <div className="h-3 w-3/4 bg-muted rounded" />
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-12 bg-muted rounded" />
          <div className="h-3 w-16 bg-muted rounded" />
        </div>
      </div>

      {/* Status badge */}
      <div className="w-16 h-6 bg-muted rounded shrink-0 self-center" />
    </div>
  );
}

/** Skeleton panel for the full conversation list */
export function MonitorListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="w-80 border-r border-border overflow-y-auto bg-card">
      {/* Search bar */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="h-8 bg-muted rounded-md" />
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={cn('h-6 bg-muted rounded-sm', i === 1 ? 'w-10' : 'w-12')} />
          ))}
        </div>
      </div>

      {/* List */}
      <div className="p-3 space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <MonitorConversationSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Skeleton panel for the conversation detail area */
export function MonitorDetailSkeleton() {
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-card">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
          <div className="space-y-1.5 min-w-0">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-3 w-48 bg-muted rounded" />
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="h-8 w-20 bg-muted rounded-md" />
          <div className="h-8 w-16 bg-muted rounded-md" />
        </div>
      </div>

      {/* Summary bar (handoff/ended) */}
      <div className="border-b border-border px-6 py-3 flex items-start gap-2 shrink-0">
        <div className="w-4 h-4 bg-muted rounded shrink-0 mt-0.5" />
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="h-3 w-16 bg-muted rounded" />
          <div className="h-3 w-full bg-muted rounded" />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-4 min-h-0">
        <div className="space-y-6 max-w-3xl mx-auto px-6">
          {/* User message */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-10 w-2/3 bg-muted rounded-lg" />
            </div>
          </div>

          {/* Assistant message */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-3 w-24 bg-muted rounded" />
              <div className="space-y-1.5">
                <div className="h-4 w-full bg-muted rounded-lg" />
                <div className="h-4 w-5/6 bg-muted rounded-lg" />
                <div className="h-4 w-4/6 bg-muted rounded-lg" />
              </div>
            </div>
          </div>

          {/* Another user message */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-12 w-3/4 bg-muted rounded-lg" />
            </div>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border p-4 shrink-0">
        <div className="h-10 bg-muted rounded-lg max-w-3xl mx-auto" />
      </div>
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils';

/** Single conversation row skeleton for the simulation history list */
function SimulationConversationSkeleton() {
  return (
    <div className="flex gap-3 p-3 animate-skeleton-pulse">
      {/* Avatar */}
      <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-28 bg-muted rounded" />
          <div className="h-4 w-16 bg-muted rounded" />
        </div>
        <div className="h-3 w-3/4 bg-muted rounded" />
        <div className="h-3 w-1/2 bg-muted rounded" />
      </div>
    </div>
  );
}

/** History list skeleton with header */
export function SimulationConversationListSkeleton({
  count = 6,
}: {
  count?: number;
}) {
  return (
    <div className="w-[300px] border-r border-border bg-card flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="h-14 px-4 flex items-center border-b border-border shrink-0">
        <div className="h-5 w-24 bg-muted rounded" />
      </div>
      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-2 space-y-1">
          {Array.from({ length: count }).map((_, i) => (
            <SimulationConversationSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Single AI message bubble skeleton (left-aligned) */
function SimulationMessageBubbleSkeleton() {
  return (
    <div className="flex gap-2 animate-skeleton-pulse">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-muted shrink-0 mt-0.5" />
      {/* Bubble */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3 w-20 rounded" />
        <div className="h-9 bg-muted rounded-lg w-5/6" />
        <div className="h-9 bg-muted rounded-lg w-2/3" />
      </div>
    </div>
  );
}

/** Single user message bubble skeleton (right-aligned) */
function SimulationUserMessageBubbleSkeleton() {
  return (
    <div className="flex gap-2 justify-end animate-skeleton-pulse">
      {/* Bubble */}
      <div className="flex-1 min-w-0 space-y-1.5 ml-auto inline-block">
        <div className="h-3 w-20 rounded ml-auto" />
        <div className="h-9 bg-muted rounded-lg w-72" />
        <div className="h-9 bg-muted rounded-lg w-56" />
      </div>
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-muted shrink-0 mt-0.5" />
    </div>
  );
}

/** Full chat area skeleton — header + messages + input */
export function SimulationChatSkeleton() {
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      {/* Chat header */}
      <div className="h-14 border-b border-border px-6 flex items-center shrink-0">
        <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
        <div className="ml-3 space-y-1">
          <div className="h-4 w-40 bg-muted rounded" />
          <div className="h-3 w-24 bg-muted rounded" />
        </div>
        {/* Action buttons placeholder */}
        <div className="ml-auto flex gap-2">
          <div className="h-8 w-20 bg-muted rounded" />
          <div className="h-8 w-20 bg-muted rounded" />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-4 min-h-0">
        <div className="space-y-5 max-w-3xl mx-auto px-6 w-full">
          <SimulationMessageBubbleSkeleton />
          <SimulationUserMessageBubbleSkeleton />
          <SimulationMessageBubbleSkeleton />
          <SimulationUserMessageBubbleSkeleton />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border p-4 shrink-0">
        <div className="h-10 bg-muted rounded-lg max-w-3xl mx-auto" />
      </div>
    </div>
  );
}

'use client';

import { Skeleton } from '@/components/ui/skeleton';

/** Skeleton for the AI Settings section - models loading state */
export function AISettingsSkeleton() {
  return (
    <div className="space-y-6">
      {/* AI Model Configuration Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <Skeleton className="h-5 w-28 mb-1" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        
        {/* Provider cards skeleton */}
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                    <div className="flex items-center gap-3 mt-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Skeleton className="w-8 h-8 rounded" />
                  <Skeleton className="w-8 h-8 rounded" />
                  <Skeleton className="w-8 h-8 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Normal Model Selection Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <Skeleton className="h-3 w-40 mb-3" />
        
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <Skeleton className="w-4 h-4 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex items-center gap-1">
                <Skeleton className="h-5 w-12 rounded" />
                <Skeleton className="h-5 w-12 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Multimodal Model Selection Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <Skeleton className="h-3 w-52 mb-3" />
        
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <Skeleton className="w-4 h-4 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <div className="flex items-center gap-1">
                <Skeleton className="h-5 w-16 rounded" />
                <Skeleton className="h-5 w-12 rounded" />
              </div>
            </div>
          ))}
        </div>

        {/* Disabled action section */}
        <div className="mt-4 pt-4 border-t border-border">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-3 w-40 mb-3" />
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                <Skeleton className="w-4 h-4 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Temperature Slider Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-5 w-8" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex justify-between mt-1">
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-8" />
        </div>
      </div>

      {/* Max Tokens Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-28 mb-1" />
        <Skeleton className="h-3 w-48 mb-3" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      {/* Max Concurrent Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-8" />
        </div>
        <Skeleton className="h-3 w-56 mb-3" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      {/* Min Score Slider Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-10" />
        </div>
        <Skeleton className="h-3 w-full mb-1" />
        <div className="flex justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>

      {/* Search Limit Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-6" />
        </div>
        <Skeleton className="h-3 w-48 mb-3" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      {/* Image Search Limit Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-6" />
        </div>
        <Skeleton className="h-3 w-52 mb-3" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>

      {/* System Prompt Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="space-y-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** Skeleton for LLM Provider Manager */
export function LLMProviderManagerSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-5 w-24 mb-1" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                  <div className="flex items-center gap-3 mt-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Skeleton className="w-8 h-8 rounded" />
                <Skeleton className="w-8 h-8 rounded" />
                <Skeleton className="w-8 h-8 rounded" />
                <Skeleton className="w-8 h-8 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for model list (used in ai-settings.tsx) */
export function ModelListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-lg border border-border animate-skeleton-pulse"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <Skeleton className="w-4 h-4 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="h-5 w-12 rounded" />
            <Skeleton className="h-5 w-12 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

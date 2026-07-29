'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <div className="h-full flex flex-col">
      {/* 内容区域骨架屏 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Metric Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <MetricCardSkeleton delay={1} />
          <MetricCardSkeleton delay={2} />
          <MetricCardSkeleton delay={3} />
          <MetricCardSkeleton delay={4} />
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <ChartCardSkeleton title="对话趋势（近7天）" delay={5} />
          <ChartCardSkeleton title="消息趋势（近7天）" delay={6} />
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <ChartCardSkeleton title="评分分布" delay={7} />
          <ChartCardSkeleton title="对话来源分布" delay={8} />
        </div>

        {/* Charts Row 3 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <ChartCardSkeleton title="满意度趋势（近7天）" delay={9} />
          <ChartCardSkeleton title="各渠道满意度" delay={10} />
        </div>

        {/* Alerts Section */}
        <div className="rounded-xl border border-border bg-card p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="space-y-3">
            <AlertItemSkeleton />
            <AlertItemSkeleton />
          </div>
        </div>

        {/* Push Records Section */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="space-y-3">
              <PushRecordSkeleton />
              <PushRecordSkeleton />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-12" />
            </div>
            <div className="space-y-3">
              <PushRecordSkeleton />
              <PushRecordSkeleton />
            </div>
          </div>
        </div>

        {/* Quick Stats Footer */}
        <div className="grid grid-cols-3 gap-4">
          <QuickStatSkeleton delay={11} />
          <QuickStatSkeleton delay={12} />
          <QuickStatSkeleton delay={13} />
        </div>
      </div>
    </div>
  );
}

function MetricCardSkeleton({ delay }: { delay: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-stagger" style={{ animationDelay: `${delay * 50}ms` }}>
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-20 mb-1" />
      <Skeleton className="h-3 w-16" />
      <div className="mt-3 pt-3 border-t border-border/50">
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}

function ChartCardSkeleton({ title, delay }: { title: string; delay: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-stagger" style={{ animationDelay: `${delay * 50}ms` }}>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-4" />
      </div>
      <Skeleton className="h-52 w-full rounded-lg" />
    </div>
  );
}

function AlertItemSkeleton() {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
      <Skeleton className="h-4 w-4 mt-0.5" />
      <div className="flex-1">
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-6 w-20" />
    </div>
  );
}

function PushRecordSkeleton() {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/50">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-3.5 w-3.5 rounded-full" />
        <div>
          <Skeleton className="h-4 w-24 mb-1" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-sm" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

function QuickStatSkeleton({ delay }: { delay: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 animate-stagger" style={{ animationDelay: `${delay * 50}ms` }}>
      <Skeleton className="w-10 h-10 rounded-lg" />
      <div>
        <Skeleton className="h-3 w-16 mb-1" />
        <Skeleton className="h-5 w-12" />
      </div>
    </div>
  );
}

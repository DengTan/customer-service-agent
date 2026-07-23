import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface KnowledgeItemsSkeletonProps {
  count?: number;
  className?: string;
}

export function KnowledgeItemsSkeleton({ count = 5, className }: KnowledgeItemsSkeletonProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="group rounded-xl border bg-card transition-all duration-200 border-border/60"
        >
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              {/* Checkbox placeholder */}
              <Skeleton className="w-3.5 h-3.5 rounded shrink-0 mt-1" />
              {/* Icon placeholder */}
              <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
              {/* Content */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                  <Skeleton className="h-4 w-12 rounded-full" />
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              {/* Actions placeholder */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Skeleton className="w-7 h-7 rounded-md" />
                <Skeleton className="w-7 h-7 rounded-md" />
                <Skeleton className="w-7 h-7 rounded-md" />
              </div>
            </div>
            {/* Content preview placeholder */}
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-4/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary for nested route segments.
 * Renders a friendly error UI within the app layout (navbar, sidebar preserved).
 * Solves EH-04.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[RouteError]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <div className="max-w-md text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-xl font-semibold">页面加载出错</h2>
        <p className="text-muted-foreground">
          当前页面遇到了问题，请尝试刷新。如果问题持续，请联系管理员。
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60">
            错误 ID: {error.digest}
          </p>
        )}
        <Button onClick={reset} variant="default">
          重试
        </Button>
      </div>
    </div>
  );
}

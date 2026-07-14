'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * A polling hook that respects tab visibility.
 * - Starts polling when enabled
 * - Pauses polling when tab is hidden (document.hidden)
 * - Immediately refreshes and resumes when tab becomes visible
 * 
 * @param callback - Function to call on each poll interval
 * @param intervalMs - Polling interval in milliseconds
 * @param enabled - Whether polling is enabled (default: true)
 */
export function useVisibilityAwarePoll(
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref in sync without triggering re-renders
  useEffect(() => {
    callbackRef.current = callback;
  });

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      callbackRef.current();
    }, intervalMs);
  }, [intervalMs]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    // Initial start
    start();

    // Visibility change handler
    const handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden: stop polling
        stop();
      } else {
        // Tab visible: immediately refresh once and restart polling
        callbackRef.current();
        start();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, start, stop]);
}

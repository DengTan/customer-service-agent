'use client';

import { useEffect, useRef, useCallback } from 'react';
import { HEARTBEAT } from '@/lib/constants';
export interface UseHeartbeatOptions {
  /** Whether heartbeat is enabled (default true) */
  enabled?: boolean;
}

/**
 * Sends a heartbeat to update the current user's last_active_at.
 *
 * Features:
 * - 60-second interval via setInterval
 * - visibilitychange: fires immediately when tab becomes visible
 * - pagehide: stops heartbeat when browser is closed
 * - localStorage deduplication across tabs (shared last-sent time)
 * - 401 auto-stop: disables heartbeat if auth expires
 * - Fire-and-forget: does not block UI
 * - Server-side throttle: 30s minimum write interval
 */
export function useHeartbeat(options: UseHeartbeatOptions = {}) {
  const { enabled = true } = options;

  const enabledRef = useRef(enabled);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const sendHeartbeat = useCallback(async () => {
    // Multi-tab deduplication via localStorage
    const storageKey = HEARTBEAT.STORAGE_KEY;
    const lastSent = localStorage.getItem(storageKey);
    const now = Date.now();
    if (lastSent && now - parseInt(lastSent, 10) < HEARTBEAT.CLIENT_INTERVAL_MS) {
      // Another tab already sent recently; skip
      return;
    }
    // Record our send time before async call
    localStorage.setItem(storageKey, String(now));

    try {
      const res = await fetch('/api/users/me/heartbeat', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 401) {
        // Auth expired — stop heartbeat silently
        stoppedRef.current = true;
      }
    } catch {
      // Fire-and-forget: ignore network errors
    }
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      stoppedRef.current = false;
      return;
    }
    if (stoppedRef.current) return;

    // Fire immediately on mount
    sendHeartbeat();

    // Set up interval
    intervalRef.current = setInterval(() => {
      if (enabledRef.current && !stoppedRef.current) {
        sendHeartbeat();
      }
    }, HEARTBEAT.CLIENT_INTERVAL_MS);

    // visibilitychange: fire immediately when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabledRef.current && !stoppedRef.current) {
        sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // pagehide: stop heartbeat when browser is closed
    const handlePageHide = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [enabled, sendHeartbeat]);
}

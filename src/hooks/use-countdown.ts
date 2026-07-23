import { useEffect, useState } from 'react';

/**
 * Format a non-negative number of seconds as `M:SS`.
 * 0 → "0:00", 65 → "1:05", 900 → "15:00".
 */
export function formatMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Count down from `initialSeconds` to 0, ticking once per second.
 * Returns the remaining seconds (number) plus a boolean `isFinished`.
 *
 * Pass `key` (e.g. the API-returned `retryAfterSeconds`) to restart the
 * countdown when the lockout value changes — using a key avoids stale-state
 * bugs from manually resetting inside the effect.
 */
export function useCountdown(
  initialSeconds: number,
  key?: string | number,
): { remainingSeconds: number; isFinished: boolean } {
  const [remaining, setRemaining] = useState(Math.max(0, Math.floor(initialSeconds)));

  useEffect(() => {
    setRemaining(Math.max(0, Math.floor(initialSeconds)));

    if (initialSeconds <= 0) return;

    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, initialSeconds > 0]);

  return { remainingSeconds: remaining, isFinished: remaining === 0 };
}
// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT } from '@/lib/constants';
import { useHeartbeat } from './use-heartbeat';

describe('useHeartbeat', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts when authentication enables the hook after mount', async () => {
    const { rerender } = renderHook(({ enabled }) => useHeartbeat({ enabled }), {
      initialProps: { enabled: false },
    });

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ enabled: true });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/users/me/heartbeat', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('does not continue sending after the hook is disabled', async () => {
    const { rerender } = renderHook(({ enabled }) => useHeartbeat({ enabled }), {
      initialProps: { enabled: true },
    });

    await act(async () => {
      await Promise.resolve();
    });
    fetchMock.mockClear();

    rerender({ enabled: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT.CLIENT_INTERVAL_MS);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops after a 401 response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    renderHook(() => useHeartbeat({ enabled: true }));

    await act(async () => {
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT.CLIENT_INTERVAL_MS);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface LazyListResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  isPolling: boolean;
  error: string | null;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
  updateItems: (updateFn: (prev: T[]) => T[]) => void;
  setTotal: (fn: (prev: number) => number) => void;
  updateItemsLength: (delta: number) => void;
  startPolling: (intervalMs: number) => void;
  cleanup: () => void;
}

export interface UseLazyListOptions<T> {
  /** Fetch function: (page, pageSize) => Promise<{ items: T[]; total: number }> */
  fetchFn: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>;
  /** Page size (default 10) */
  pageSize?: number;
}

/**
 * Generic lazy-loading hook with pagination, polling, and refresh.
 *
 * Key design decisions (learned from bugs):
 * - fetchFn is held via ref so internal callbacks never go stale
 * - No hasAutoLoadedRef guard (it caused reset() to short-circuit)
 * - itemsLengthRef tracks current count for refresh-without-data-loss
 * - currentPageRef avoids stale closure in loadMore
 */
export function useLazyList<T>(options: UseLazyListOptions<T>): LazyListResult<T> {
  const { fetchFn, pageSize = 10 } = options;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for stable callback access
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const currentPageRef = useRef(0);
  const itemsLengthRef = useRef(0);
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sync itemsLengthRef
  useEffect(() => {
    itemsLengthRef.current = items.length;
  }, [items.length]);

  const loadInitial = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsInitialLoading(true);
    setError(null);
    try {
      const result = await fetchFnRef.current(1, pageSizeRef.current);
      if (controller.signal.aborted) return;
      // Deduplicate by ID to avoid React key collision
      const existingIds = new Set<string>();
      const uniqueItems: T[] = [];
      for (const item of result.items) {
        const id = (item as { id: string }).id;
        if (!existingIds.has(id)) {
          existingIds.add(id);
          uniqueItems.push(item);
        }
      }
      setItems(uniqueItems);
      setTotal(result.total);
      currentPageRef.current = 1;
      itemsLengthRef.current = uniqueItems.length;
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : '加载失败';
      setError(msg);
    } finally {
      if (!controller.signal.aborted) {
        setIsInitialLoading(false);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    const nextPage = currentPageRef.current + 1;
    setIsLoadingMore(true);
    try {
      const result = await fetchFnRef.current(nextPage, pageSizeRef.current);
      // Deduplicate by ID to avoid React key collision if backend returns stale data
      setItems((prev) => {
        const existingIds = new Set(prev.map((item) => (item as { id: string }).id));
        const newItems = result.items.filter((item) => !existingIds.has((item as { id: string }).id));
        return [...prev, ...newItems];
      });
      setTotal(result.total);
      currentPageRef.current = nextPage;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载更多失败';
      setError(msg);
    } finally {
      setIsLoadingMore(false);
    }
  }, []);

  const reset = useCallback(async () => {
    setItems([]);
    setTotal(0);
    currentPageRef.current = 0;
    itemsLengthRef.current = 0;
    setError(null);
    await loadInitial();
  }, [loadInitial]);

  const refresh = useCallback(async () => {
    // Abort any in-flight request before starting
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Refresh with current loaded amount, not losing expanded data
    const currentCount = Math.max(itemsLengthRef.current, pageSizeRef.current);
    setError(null);
    try {
      const result = await fetchFnRef.current(1, currentCount);
      if (controller.signal.aborted) return;
      // Deduplicate by ID to avoid React key collision
      const existingIds = new Set<string>();
      const uniqueItems: T[] = [];
      for (const item of result.items) {
        const id = (item as { id: string }).id;
        if (!existingIds.has(id)) {
          existingIds.add(id);
          uniqueItems.push(item);
        }
      }
      setItems(uniqueItems);
      setTotal(result.total);

      // P1-1 fix: If server returned fewer items than requested, it means
      // we've hit the real end of data — currentPageRef stays at the last
      // page that still has items. Otherwise update normally.
      const newPage = Math.max(1, Math.ceil(result.items.length / pageSizeRef.current));
      if (result.items.length >= currentCount) {
        // Normal case: all requested items returned, update page
        currentPageRef.current = newPage;
      }
      // If fewer returned (e.g. deletions), keep currentPageRef as-is so
      // next loadMore still goes to the right page.
      itemsLengthRef.current = result.items.length;
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : '刷新失败';
      setError(msg);
    }
  }, []);

  const updateItems = useCallback((updateFn: (prev: T[]) => T[]) => {
    setItems(updateFn);
  }, []);

  // P2-1: Allow callers to adjust itemsLengthRef (e.g., after deleting an item)
  const updateItemsLength = useCallback((delta: number) => {
    itemsLengthRef.current = Math.max(0, itemsLengthRef.current + delta);
  }, []);

  const startPolling = useCallback((intervalMs: number) => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
    }
    setIsPolling(true);
    pollingTimerRef.current = setInterval(() => {
      refresh();
    }, intervalMs);
  }, [refresh]);

  const cleanup = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setIsPolling(false);
    abortRef.current?.abort();
  }, []);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
      }
      abortRef.current?.abort();
    };
  }, []);

  const hasMore = items.length < total;

  return {
    items,
    total,
    hasMore,
    isInitialLoading,
    isLoadingMore,
    isPolling,
    error,
    loadInitial,
    loadMore,
    reset,
    refresh,
    updateItems,
    setTotal,
    updateItemsLength,
    startPolling,
    cleanup,
  };
}

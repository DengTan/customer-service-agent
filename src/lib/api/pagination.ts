// src/lib/api/pagination.ts
//
// Unified page/limit parsing + PageResult builder used by every paginated
// route. Centralised here so the route contract (`{ items, total, page,
// limit, hasMore }`) stays consistent across the API surface.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page?: number;
  limit?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ParsedPage {
  page: number;
  limit: number;
  offset: number;
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parsePageParams(searchParams: URLSearchParams | Record<string, string | string[] | undefined>): ParsedPage {
  const get = (key: string): string | undefined => {
    if (searchParams instanceof URLSearchParams) return searchParams.get(key) ?? undefined;
    const v = (searchParams as Record<string, string | string[] | undefined>)[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const page = toPositiveInt(get('page'), 1);
  const rawLimit = toPositiveInt(get('limit'), DEFAULT_PAGE_SIZE);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function buildPageResult<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PageResult<T> {
  return {
    items,
    total,
    page,
    limit,
    hasMore: page * limit < total,
  };
}

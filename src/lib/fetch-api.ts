/**
 * Frontend fetch wrapper for SmartAssist.
 *
 * Stage A / A5c: every cross-cutting fetch should go through `fetchApi()`
 * so that RFC 7807 Problem Details responses (`application/problem+json`)
 * are surfaced to callers as `ApiProblemError`. The wrapper also attaches
 * the auth cookie automatically and follows the documented CORS contract.
 */

import { logger as loggerCollection } from '@/lib/logger';

const apiLogger = loggerCollection.api;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Parsed RFC 7807 problem document. */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

export class ApiProblemError extends Error {
  readonly problem: ApiProblem;
  readonly status: number;
  constructor(problem: ApiProblem, response: Response) {
    super(problem.detail ?? problem.title ?? 'API error');
    this.name = 'ApiProblemError';
    this.problem = problem;
    this.status = problem.status ?? response.status;
  }

  /** Convenience accessors for commonly-used extension fields. */
  get code(): string | undefined {
    return typeof this.problem.code === 'string' ? this.problem.code : undefined;
  }
  get type(): string {
    return this.problem.type;
  }
  get detail(): string | undefined {
    return this.problem.detail;
  }
  get meta(): Record<string, unknown> | undefined {
    return this.problem.meta && typeof this.problem.meta === 'object'
      ? (this.problem.meta as Record<string, unknown>)
      : undefined;
  }
}

export interface FetchApiOptions {
  method?: string;
  headers?: HeadersInit;
  /** When provided, the body is JSON-stringified and Content-Type is set. */
  json?: unknown;
  /** Raw body — used when `json` is not provided. */
  body?: BodyInit | null;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  mode?: RequestMode;
  priority?: RequestPriority;
  window?: null;
}

export async function fetchApi<T = unknown>(
  url: string,
  options: FetchApiOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const body: BodyInit | null | undefined = options.json !== undefined
    ? JSON.stringify(options.json)
    : options.body;
  if (options.json !== undefined) {
    headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json');
  }

  const signal = options.signal;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body,
      credentials: options.credentials ?? 'include',
      signal,
      cache: options.cache,
      redirect: options.redirect,
      referrer: options.referrer,
      referrerPolicy: options.referrerPolicy,
      integrity: options.integrity,
      keepalive: options.keepalive,
      mode: options.mode,
      priority: options.priority,
      window: options.window,
    });
  } catch (err) {
    apiLogger.error('[fetchApi] network error', { url, error: String(err) });
    throw err;
  }

  if (!response.ok || response.headers.get('Content-Type')?.includes(PROBLEM_CONTENT_TYPE)) {
    let problem: ApiProblem | null = null;
    try {
      problem = (await response.json()) as ApiProblem;
    } catch {
      problem = {
        type: 'about:blank',
        title: response.statusText || 'Error',
        status: response.status,
      };
    }
    throw new ApiProblemError(problem, response);
  }

  // 204 / empty body short-circuit
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Type guard for `ApiProblemError`. */
export function isApiProblem(err: unknown): err is ApiProblemError {
  return err instanceof ApiProblemError;
}

/**
 * Convert a `Response` carrying `application/problem+json` into an
 * `ApiProblemError`. Returns `null` when the response is not a problem
 * document so callers can branch on content type.
 */
export async function parseProblem(response: Response): Promise<ApiProblemError | null> {
  const ct = response.headers.get('Content-Type') ?? '';
  if (!ct.includes(PROBLEM_CONTENT_TYPE)) {
    return null;
  }
  let problem: ApiProblem;
  try {
    problem = (await response.clone().json()) as ApiProblem;
  } catch {
    problem = { type: 'about:blank', title: response.statusText || 'Error', status: response.status };
  }
  return new ApiProblemError(problem, response);
}
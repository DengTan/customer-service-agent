/**
 * RFC 7807 Problem Details for HTTP APIs (application/problem+json).
 *
 * Reference: https://www.rfc-editor.org/rfc/rfc7807
 *
 * Stage A / A5c replaces the legacy `{ success, error }` envelope with RFC 7807
 * for all error responses. The legacy shape is still emitted by `apiSuccess()`.
 * Clients should adopt `application/problem+json` parsing via
 * `src/lib/fetch-api.ts`.
 */

import { NextResponse } from 'next/server';

export type ProblemType =
  | 'about:blank'
  | '/problems/unauthorized'
  | '/problems/forbidden'
  | '/problems/not-found'
  | '/problems/bad-request'
  | '/problems/rate-limited'
  | '/problems/internal-error'
  | '/problems/cors';

export interface ProblemJson {
  type: ProblemType | string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Extension members allowed by RFC 7807 §3.2. */
  [extension: string]: unknown;
}

export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';

const TYPE_BY_STATUS: Record<number, { type: ProblemType; title: string }> = {
  400: { type: '/problems/bad-request', title: 'Bad Request' },
  401: { type: '/problems/unauthorized', title: 'Unauthorized' },
  403: { type: '/problems/forbidden', title: 'Forbidden' },
  404: { type: '/problems/not-found', title: 'Not Found' },
  409: { type: '/problems/bad-request', title: 'Conflict' },
  422: { type: '/problems/bad-request', title: 'Unprocessable Entity' },
  429: { type: '/problems/rate-limited', title: 'Too Many Requests' },
  500: { type: '/problems/internal-error', title: 'Internal Server Error' },
  503: { type: '/problems/internal-error', title: 'Service Unavailable' },
};

/**
 * Build a Problem Details object. The `instance` field defaults to the
 * incoming request URL when provided.
 */
export function buildProblem(
  status: number,
  detail?: string,
  options: { type?: string; title?: string; instance?: string; extensions?: Record<string, unknown> } = {},
): ProblemJson {
  const fallback = TYPE_BY_STATUS[status] ?? { type: 'about:blank' as ProblemType, title: 'Error' };
  const problem: ProblemJson = {
    type: options.type ?? fallback.type,
    title: options.title ?? fallback.title,
    status,
  };
  if (detail) problem.detail = detail;
  if (options.instance) problem.instance = options.instance;
  if (options.extensions) {
    for (const [k, v] of Object.entries(options.extensions)) {
      problem[k] = v;
    }
  }
  return problem;
}

/**
 * Convert a Problem Details object into a NextResponse with the correct
 * Content-Type and the requested status code.
 */
export function problemResponse(
  status: number,
  detail?: string,
  options: { type?: string; title?: string; instance?: string; extensions?: Record<string, unknown>; headers?: Record<string, string> } = {},
): NextResponse {
  const problem = buildProblem(status, detail, options);
  const headers: Record<string, string> = {
    'Content-Type': PROBLEM_JSON_CONTENT_TYPE,
    ...(options.headers ?? {}),
  };
  return new NextResponse(JSON.stringify(problem), { status, headers });
}
/**
 * Unified Zod parse entry (B3).
 *
 * Every external API route that accepts JSON body, query params, or headers
 * MUST use this module to validate inputs. It wraps Zod parsing with RFC 7807
 * error responses and project logger.
 *
 * Usage:
 * ```ts
 * import { parseBody, parseQuery, parseParams, HttpStatus } from '@/lib/api/parse';
 *
 * // In a route handler (synchronous):
 * const body = parseBody(request, MyBodySchema);
 * if (body instanceof Response) return body; // RFC 7807 error already sent
 *
 * // With async schemas or extra transforms:
 * const parsed = await parseBodyAsync(request, MyAsyncBodySchema);
 * if (parsed instanceof Response) return parsed;
 *
 * // Query params:
 * const query = parseQuery(request, MyQuerySchema);
 *
 * // Path params:
 * const params = parseParams({ id: z.string().uuid() }, rawParams);
 * ```
 *
 * Design decisions:
 * - Synchronous `parseBody` throws on parse failure (returns Response for
 *   use in async route handlers without try/catch boilerplate)
 * - All parse failures return RFC 7807 `application/problem+json` responses
 * - Unknown fields in input are stripped (no `z.unknown()` fallbacks)
 * - Supports optional `.catch()` override for graceful degradation
 */

import { NextRequest, type NextResponse } from 'next/server';
import { z, type ZodError, type ZodSchema, type ZodTypeAny } from 'zod';
import { problemResponse } from '@/lib/api/problem-json';
import { HttpStatus } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/** Convert a ZodError to RFC 7807 extensions (Zod v4: uses .issues). */
function zodErrorToExtensions(err: ZodError): Record<string, unknown> {
  return {
    errors: err.issues.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
      code: e.code,
    })),
  };
}

/**
 * Parse a JSON body from a NextRequest.
 * Returns the parsed object on success, or an RFC 7807 NextResponse on failure.
 * MUST be used with `await` in async route handlers.
 *
 * Options:
 * - `allowEmpty: true`: treat missing/malformed body as empty object {}
 * - `strict: true` (default): strip unknown fields (Zod default)
 */
export async function parseBody<T extends ZodTypeAny>(
  request: NextRequest,
  schema: T,
  options: { allowEmpty?: boolean } = {}
): Promise<z.infer<T> | NextResponse> {
  const { allowEmpty = false } = options;

  let body: unknown;
  try {
    const text = await request.text();
    if (!text || text.trim() === '') {
      if (allowEmpty) {
        body = {};
      } else {
        return problemResponse(HttpStatus.BAD_REQUEST, 'Request body is required', {
          extensions: { code: 'MISSING_BODY' },
        });
      }
    } else {
      body = JSON.parse(text);
    }
  } catch {
    return problemResponse(HttpStatus.BAD_REQUEST, 'Invalid JSON in request body', {
      extensions: { code: 'INVALID_JSON' },
    });
  }

  const result = await schema.safeParseAsync(body);

  if (!result.success) {
    logger.api.warn('[parseBody] validation failed', {
      path: request.nextUrl.pathname,
      issueCount: result.error.issues.length,
    });
    return problemResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'Invalid request body', {
      extensions: zodErrorToExtensions(result.error),
    });
  }

  return result.data as z.infer<T>;
}

/**
 * Parse URL search params.
 * Returns the parsed object on success, or an RFC 7807 NextResponse on failure.
 */
export function parseQuery<T extends ZodTypeAny>(
  request: NextRequest,
  schema: T
): z.infer<T> | NextResponse {
  const rawParams = Object.fromEntries(request.nextUrl.searchParams);
  const result = schema.safeParse(rawParams);

  if (!result.success) {
    logger.api.warn('[parseQuery] validation failed', {
      path: request.nextUrl.pathname,
      issueCount: result.error.issues.length,
    });
    return problemResponse(HttpStatus.BAD_REQUEST, 'Invalid query parameters', {
      extensions: zodErrorToExtensions(result.error),
    });
  }

  return result.data as z.infer<T>;
}

/**
 * Validate path params (from `[id]` route segments etc.) against a Zod object.
 * Returns the parsed object on success, or an RFC 7807 NextResponse on failure.
 */
export function parseParams<T extends z.ZodRawShape>(
  shape: T,
  rawParams: Record<string, string | undefined>
): z.infer<z.ZodObject<T>> | NextResponse {
  const schema = z.object(shape);
  const result = schema.safeParse(rawParams);

  if (!result.success) {
    return problemResponse(HttpStatus.BAD_REQUEST, 'Invalid path parameters', {
      extensions: zodErrorToExtensions(result.error),
    });
  }

  return result.data as z.infer<z.ZodObject<T>>;
}

/**
 * Parse a single header value. Returns the string on success, or null if missing.
 * For required headers, combine with a schema check.
 */
export function parseHeader(
  request: NextRequest,
  headerName: string,
  schema?: ZodSchema<string>
): string | null {
  const raw = request.headers.get(headerName);
  if (!raw) return null;
  if (schema) {
    const result = schema.safeParse(raw);
    if (!result.success) return null;
    return result.data;
  }
  return raw;
}

// ─── Common reusable schemas ────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).optional(),
});

export const IdParamSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const SortSchema = z.object({
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const SearchSchema = z.object({
  search: z.string().optional(),
  q: z.string().optional(),
});

// Zod v4: use z.object({ ... }).merge() directly; keep this as a note.

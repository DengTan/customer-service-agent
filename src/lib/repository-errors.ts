/**
 * Repository error contract for SmartAssist.
 *
 * Centralizes the four canonical repository error kinds and the branded ID
 * types used across data access layers. Solves root-cause #8 of the multi-agent
 * audit: every repository in the project threw ad-hoc Error instances with
 * inconsistent shapes, forcing callers to do string-matching on messages.
 *
 * Layers may throw these directly, or use `mapSupabaseError` to translate
 * PostgREST errors into the appropriate subtype.
 *
 * IMPORTANT: This file does not import anything from `@/server` to keep it
 * usable from both client and server contexts.
 */

import { logger } from '@/lib/logger';

// ─── Branded ID Types ───────────────────────────────────────────────────────

/**
 * Branded type for Gorgias ticket IDs.
 *
 * Gorgias returns ticket IDs as JSON numbers (e.g. `68790392`), but PostgreSQL
 * `bigint` columns store them as strings — and the `json` round-trip can
 * silently convert large numbers to scientific notation (`6.8790392e+07`),
 * breaking equality and unique index lookups (see SR-007 follow-up notes).
 *
 * Using a branded string forces all call sites to pass through
 * `toGorgiasTicketId`, which normalizes the value to a canonical decimal
 * string before it touches the database.
 */
export type GorgiasTicketId = string & { readonly __brand: 'GorgiasTicketId' };

export type GorgiasMessageId = string & { readonly __brand: 'GorgiasMessageId' };

export type TicketId = string & { readonly __brand: 'TicketId' };

export type KnowledgeItemId = string & { readonly __brand: 'KnowledgeItemId' };

/**
 * Sprint 6 — branded CustomerId. All callers that produce a customer id MUST
 * go through `toCustomerId` so non-UUID strings (e.g. scientific-notation
 * leftovers, empty values) are rejected at the boundary.
 */
export type CustomerId = string & { readonly __brand: 'CustomerId' };

/**
 * Branded string types are produced by the dedicated constructors below
 * (e.g. `toGorgiasTicketId`). A generic `Brand<TBase, TBrand>` helper is
 * intentionally NOT exported to keep the public surface small; callers that
 * need a new branded type should follow the same naming pattern.
 */

/**
 * Normalize a Gorgias ticket ID value (string or number) into a canonical
 * decimal-string branded ID. Throws if the input cannot be coerced to a
 * positive integer.
 */
export function toGorgiasTicketId(input: string | number): GorgiasTicketId {
  const s = normalizeIntegerLike(input, { min: 1, fieldName: 'GorgiasTicketId' });
  return s as GorgiasTicketId;
}

/**
 * Normalize a Gorgias message ID value (string or number) into a canonical
 * decimal-string branded ID. Same rules as `toGorgiasTicketId`.
 */
export function toGorgiasMessageId(input: string | number): GorgiasMessageId {
  const s = normalizeIntegerLike(input, { min: 1, fieldName: 'GorgiasMessageId' });
  return s as GorgiasMessageId;
}

/**
 * Brand a UUID-shaped string as a TicketId. Throws if the input is not a
 * 36-character UUID-ish string (we accept either standard UUIDs or the
 * project's `gen_random_uuid()` outputs).
 */
export function toTicketId(input: string): TicketId {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ValidationError('TicketId must be a non-empty string', {
      operation: 'toTicketId',
      code: 'INVALID_TICKET_ID',
    });
  }
  return input as TicketId;
}

/**
 * Brand a string as a KnowledgeItemId. Accepts any non-empty string; the
 * database uses varchar(36) so callers should pass UUID-shaped values.
 */
export function toKnowledgeItemId(input: string): KnowledgeItemId {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ValidationError('KnowledgeItemId must be a non-empty string', {
      operation: 'toKnowledgeItemId',
      code: 'INVALID_KNOWLEDGE_ITEM_ID',
    });
  }
  return input as KnowledgeItemId;
}

/**
 * Sprint 6 — brand a customer id. Rejects empty / whitespace strings; the
 * callers do not need strict UUID-shape validation because legacy / demo-mode
 * ids use `demo-cust-<timestamp>` shapes. We only require non-emptiness here;
 * downstream repository calls add stricter shape checks if needed.
 */
export function toCustomerId(input: string): CustomerId {
  if (typeof input !== 'string') {
    throw new ValidationError('CustomerId must be a string', {
      operation: 'toCustomerId',
      code: 'INVALID_CUSTOMER_ID',
    });
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('CustomerId must be a non-empty string', {
      operation: 'toCustomerId',
      code: 'INVALID_CUSTOMER_ID',
    });
  }
  return trimmed as CustomerId;
}

// ─── Error Kind Discriminator ───────────────────────────────────────────────

export type RepositoryErrorKind =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNSUPPORTED'
  | 'INTERNAL';

export interface RepositoryErrorOptions {
  /** The logical operation that produced the error (e.g. `findById`). */
  operation: string;
  /** Stable machine-readable error code (e.g. `TICKET_NOT_FOUND`). */
  code: string;
  /** Underlying cause; preserved for `cause` chaining and logging. */
  cause?: unknown;
  /** Free-form structured context for logging. */
  details?: Record<string, unknown>;
}

// ─── Base + Concrete Errors ─────────────────────────────────────────────────

export abstract class RepositoryError extends Error {
  abstract readonly kind: RepositoryErrorKind;
  readonly operation: string;
  readonly code: string;
  override readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: RepositoryErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.operation = options.operation;
    this.code = options.code;
    if (options.cause !== undefined) this.cause = options.cause;
    if (options.details !== undefined) this.details = options.details;
    // Restore the prototype chain after super() in transpiled targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** A stable, JSON-serializable shape suitable for API responses / logs. */
  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      name: this.name,
      operation: this.operation,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class NotFoundError extends RepositoryError {
  readonly kind = 'NOT_FOUND' as const;
}

export class ConflictError extends RepositoryError {
  readonly kind = 'CONFLICT' as const;
}

/**
 * R-1 (Sprint 3): thrown when the database/backend reports that a feature
 * (e.g. an RPC function, an extension) is not available. Distinct from
 * NOT_FOUND (which signals a missing row) and INTERNAL (which signals an
 * unexpected programming error).
 *
 * Concrete trigger today: PostgreSQL 42883 (`undefined_function` /
 * `no_such_function`) when a Supabase RPC such as `match_knowledge_chunks`
 * does not exist on the deployment. Callers should treat this as "feature
 * unavailable" and degrade gracefully (e.g. fall back to BM25-only).
 */
export class UnsupportedFeatureError extends RepositoryError {
  readonly kind = 'UNSUPPORTED' as const;
}

export class ValidationError extends RepositoryError {
  readonly kind = 'VALIDATION' as const;
}

export class InternalError extends RepositoryError {
  readonly kind = 'INTERNAL' as const;
}

/** Narrowing helper: is `err` a `RepositoryError`? */
export function isRepositoryError(err: unknown): err is RepositoryError {
  return err instanceof RepositoryError;
}

// ─── Supabase Error Mapping ─────────────────────────────────────────────────

/**
 * Subset of PostgREST error shape that we depend on. We deliberately do not
 * import `@supabase/supabase-js` types here to avoid coupling this module to
 * the SDK version.
 */
export interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/**
 * Map a Supabase PostgREST error to the appropriate `RepositoryError` subtype.
 *
 * Mapping table:
 * | PostgREST code         | RepositoryError kind |
 * |------------------------|----------------------|
 * | PGRST116               | NotFoundError        |
 * | 42883 (undefined_function)   | UnsupportedFeatureError |
 * | 23505 (unique_violation)         | ConflictError   |
 * | 23503 (foreign_key_violation)    | ConflictError   |
 * | 23514 (check_violation)          | ValidationError |
 * | 22P02 (invalid_text_repr)        | ValidationError |
 * | 23502 (not_null_violation)       | ValidationError |
 * | (default)                        | InternalError   |
 *
 * @param err - The error returned by `@supabase/supabase-js`.
 * @param operation - Logical operation label (e.g. `tickets.findById`).
 */
export function mapSupabaseError(err: unknown, operation: string): RepositoryError {
  const e = (err ?? {}) as SupabaseErrorLike;
  const code = e.code ?? '';
  const message = (e.message ?? 'Unknown database error').slice(0, 500);
  const details = e.details ? { supabaseDetails: e.details, hint: e.hint } : undefined;

  // PGRST116: "Results contain 0 rows" — `.single()` / `.maybeSingle()` failure.
  if (code === 'PGRST116') {
    return new NotFoundError(message, {
      operation,
      code: 'PGRST_NO_ROWS',
      cause: err,
      details,
    });
  }

  // 42883 undefined_function: RPC such as match_knowledge_chunks is missing.
  // Callers should fall back gracefully (e.g. BM25-only search).
  if (code === '42883') {
    return new UnsupportedFeatureError(message, {
      operation,
      code: 'UNDEFINED_FUNCTION',
      cause: err,
      details,
    });
  }

  // 23505 unique_violation: duplicates.
  if (code === '23505') {
    return new ConflictError(message, {
      operation,
      code: 'UNIQUE_VIOLATION',
      cause: err,
      details,
    });
  }

  // 23503 foreign_key_violation: references that no longer exist.
  if (code === '23503') {
    return new ConflictError(message, {
      operation,
      code: 'FOREIGN_KEY_VIOLATION',
      cause: err,
      details,
    });
  }

  // 23514 check_violation, 22P02 invalid_text_representation, 23502 not_null
  if (code === '23514' || code === '22P02' || code === '23502') {
    return new ValidationError(message, {
      operation,
      code: code,
      cause: err,
      details,
    });
  }

  // Default: treat unknown codes as internal errors.
  logger.database?.warn?.('repository-errors: unmapped Supabase error code', {
    operation,
    code,
    message,
  });

  return new InternalError(message, {
    operation,
    code: code || 'UNKNOWN_DB_ERROR',
    cause: err,
    details,
  });
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

interface NormalizeOptions {
  min: number;
  fieldName: string;
}

/**
 * Coerce a string-or-number ID to a canonical decimal-string representation.
 * Rejects scientific notation, NaN, Infinity, and zero/negative values.
 */
function normalizeIntegerLike(input: string | number, opts: NormalizeOptions): string {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input)) {
      throw new ValidationError(`${opts.fieldName} must be a finite integer`, {
        operation: `to${opts.fieldName}`,
        code: 'INVALID_ID',
        details: { received: input },
      });
    }
    if (input < opts.min) {
      throw new ValidationError(`${opts.fieldName} must be >= ${opts.min}`, {
        operation: `to${opts.fieldName}`,
        code: 'INVALID_ID',
        details: { received: input },
      });
    }
    // Always stringify with no exponent; integers are exact in JS up to 2^53.
    return String(input);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      throw new ValidationError(`${opts.fieldName} must be a non-empty string`, {
        operation: `to${opts.fieldName}`,
        code: 'INVALID_ID',
      });
    }
    // Reject scientific notation explicitly.
    if (/[eE]/.test(trimmed)) {
      throw new ValidationError(
        `${opts.fieldName} must not use scientific notation`,
        {
          operation: `to${opts.fieldName}`,
          code: 'INVALID_ID',
          details: { received: trimmed },
        },
      );
    }
    if (!/^-?\d+$/.test(trimmed)) {
      throw new ValidationError(`${opts.fieldName} must be a decimal integer string`, {
        operation: `to${opts.fieldName}`,
        code: 'INVALID_ID',
        details: { received: trimmed },
      });
    }
    // Use BigInt to safely compare; if number is too large we still keep the
    // string as-is.
    try {
      const n = BigInt(trimmed);
      if (n < BigInt(opts.min)) {
        throw new ValidationError(`${opts.fieldName} must be >= ${opts.min}`, {
          operation: `to${opts.fieldName}`,
          code: 'INVALID_ID',
          details: { received: trimmed },
        });
      }
    } catch {
      // BigInt parse failure already caught by the regex above; fall through.
    }
    return trimmed;
  }

  throw new ValidationError(`${opts.fieldName} must be a string or number`, {
    operation: `to${opts.fieldName}`,
    code: 'INVALID_ID',
  });
}
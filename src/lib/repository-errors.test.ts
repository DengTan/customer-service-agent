import { describe, it, expect } from 'vitest';
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
  isRepositoryError,
  mapSupabaseError,
  toGorgiasMessageId,
  toGorgiasTicketId,
  toKnowledgeItemId,
  toTicketId,
} from './repository-errors';

describe('RepositoryError hierarchy', () => {
  it('exposes four kinds and preserves code/operation/details/cause', () => {
    const cause = new Error('boom');
    const err = new ConflictError('duplicate key', {
      operation: 'tickets.insert',
      code: 'TICKET_DUP',
      cause,
      details: { ticketNumber: 'T-1' },
    });
    expect(err.kind).toBe('CONFLICT');
    expect(err.code).toBe('TICKET_DUP');
    expect(err.operation).toBe('tickets.insert');
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ ticketNumber: 'T-1' });
    expect(err.message).toBe('duplicate key');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConflictError);
    expect(isRepositoryError(err)).toBe(true);
  });

  it('toJSON returns a stable shape', () => {
    const err = new NotFoundError('not here', {
      operation: 'tickets.findById',
      code: 'NOT_FOUND',
    });
    expect(err.toJSON()).toEqual({
      kind: 'NOT_FOUND',
      name: 'NotFoundError',
      operation: 'tickets.findById',
      code: 'NOT_FOUND',
      message: 'not here',
      details: undefined,
    });
  });

  it('isRepositoryError returns false for non-repository errors', () => {
    expect(isRepositoryError(new Error('x'))).toBe(false);
    expect(isRepositoryError(null)).toBe(false);
    expect(isRepositoryError('boom')).toBe(false);
  });
});

describe('mapSupabaseError', () => {
  it('maps PGRST116 to NotFoundError', () => {
    const err = mapSupabaseError(
      { code: 'PGRST116', message: 'Results contain 0 rows', details: 'foo' },
      'tickets.findById',
    );
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.kind).toBe('NOT_FOUND');
    expect(err.code).toBe('PGRST_NO_ROWS');
    expect(err.operation).toBe('tickets.findById');
    expect(err.details).toEqual({ supabaseDetails: 'foo', hint: undefined });
  });

  it('maps 23505 unique_violation to ConflictError', () => {
    const err = mapSupabaseError(
      { code: '23505', message: 'duplicate key value violates unique constraint' },
      'tickets.insert',
    );
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('UNIQUE_VIOLATION');
  });

  it('maps 23514 check_violation to ValidationError', () => {
    const err = mapSupabaseError(
      { code: '23514', message: 'check constraint violated' },
      'tickets.insert',
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.kind).toBe('VALIDATION');
  });

  it('falls back to InternalError for unknown codes', () => {
    const err = mapSupabaseError(
      { code: 'XX999', message: 'mystery' },
      'tickets.findAll',
    );
    expect(err).toBeInstanceOf(InternalError);
    expect(err.code).toBe('XX999');
  });

  it('handles null/undefined error objects gracefully', () => {
    const err = mapSupabaseError(null, 'op');
    expect(err).toBeInstanceOf(InternalError);
    expect(err.code).toBe('UNKNOWN_DB_ERROR');
  });
});

describe('branded ID constructors', () => {
  it('toGorgiasTicketId accepts numbers and strings', () => {
    expect(toGorgiasTicketId(68790392)).toBe('68790392');
    expect(toGorgiasTicketId('68790392')).toBe('68790392');
    expect(toGorgiasTicketId('  68790392  ')).toBe('68790392');
  });

  it('toGorgiasTicketId rejects scientific notation strings (JSON round-trip hazard)', () => {
    // Real-world hazard: Gorgias payloads with IDs past 2^53 come back as
    // strings in scientific notation. The number form `6.8790392e7` evaluates
    // to the exact integer 68790392 and is therefore safe to accept.
    expect(() => toGorgiasTicketId('6.8790392e+07')).toThrow(ValidationError);
    expect(() => toGorgiasTicketId('1e5')).toThrow(ValidationError);
  });

  it('toGorgiasTicketId rejects zero, negative, NaN, Infinity', () => {
    expect(() => toGorgiasTicketId(0)).toThrow(ValidationError);
    expect(() => toGorgiasTicketId(-1)).toThrow(ValidationError);
    expect(() => toGorgiasTicketId(NaN)).toThrow(ValidationError);
    expect(() => toGorgiasTicketId(Infinity)).toThrow(ValidationError);
  });

  it('toGorgiasTicketId rejects non-numeric strings', () => {
    expect(() => toGorgiasTicketId('abc')).toThrow(ValidationError);
    expect(() => toGorgiasTicketId('')).toThrow(ValidationError);
    expect(() => toGorgiasTicketId('12.5')).toThrow(ValidationError);
  });

  it('toGorgiasTicketId rejects non-string/non-number types', () => {
    // @ts-expect-error - exercising runtime guard
    expect(() => toGorgiasTicketId({})).toThrow(ValidationError);
    // @ts-expect-error - exercising runtime guard
    expect(() => toGorgiasTicketId(null)).toThrow(ValidationError);
  });

  it('toGorgiasMessageId follows same rules as toGorgiasTicketId', () => {
    expect(toGorgiasMessageId(123)).toBe('123');
    expect(toGorgiasMessageId('123')).toBe('123');
    expect(() => toGorgiasMessageId('1e5')).toThrow(ValidationError);
  });

  it('toTicketId accepts non-empty strings and rejects empty', () => {
    expect(toTicketId('a1b2c3')).toBe('a1b2c3');
    expect(() => toTicketId('')).toThrow(ValidationError);
    // @ts-expect-error - exercising runtime guard
    expect(() => toTicketId(null)).toThrow(ValidationError);
  });

  it('toKnowledgeItemId accepts non-empty strings and rejects empty', () => {
    expect(toKnowledgeItemId('uuid-like')).toBe('uuid-like');
    expect(() => toKnowledgeItemId('')).toThrow(ValidationError);
  });
});
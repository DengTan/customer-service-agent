/**
 * Sprint 3 — R-7: retrieval error classifier tests.
 *
 * The classifier picks one of NETWORK / NOT_FOUND / UNSUPPORTED /
 * DATA_ERROR / UNKNOWN plus a log level. We assert each branch and the
 * orchestration boundary cases (null, non-Error throw, string throw).
 */
import { describe, it, expect } from 'vitest';
import { classifyRetrievalError } from '@/server/services/retrieval-error-classifier';
import {
  NotFoundError,
  UnsupportedFeatureError,
  ValidationError,
  InternalError,
  ConflictError,
} from '@/lib/repository-errors';

describe('R-7: classifyRetrievalError', () => {
  it('NETWORK for TypeError("fetch failed")', () => {
    const cls = classifyRetrievalError(Object.assign(new TypeError('fetch failed')));
    expect(cls.kind).toBe('NETWORK');
    expect(cls.level).toBe('warn');
  });

  it('NETWORK for AbortError (e.g. timeout)', () => {
    const cls = classifyRetrievalError(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(cls.kind).toBe('NETWORK');
    expect(cls.level).toBe('warn');
  });

  it('NETWORK for ECONNRESET / socket hang up messages', () => {
    expect(classifyRetrievalError(new Error('socket hang up')).kind).toBe('NETWORK');
    expect(classifyRetrievalError(new Error('read ECONNRESET')).kind).toBe('NETWORK');
    expect(classifyRetrievalError(new Error('getaddrinfo ENOTFOUND api.example.com')).kind).toBe('NETWORK');
  });

  it('NOT_FOUND for PGRST116 envelope → debug level', () => {
    const err = new NotFoundError('no rows', { operation: 'test', code: 'PGRST_NO_ROWS' });
    const cls = classifyRetrievalError(err);
    expect(cls.kind).toBe('NOT_FOUND');
    expect(cls.level).toBe('debug');
  });

  it('UNSUPPORTED for UnsupportedFeatureError → warn level', () => {
    const err = new UnsupportedFeatureError('function not found', { operation: 'test', code: 'UNDEFINED_FUNCTION' });
    const cls = classifyRetrievalError(err);
    expect(cls.kind).toBe('UNSUPPORTED');
    expect(cls.level).toBe('warn');
  });

  it('DATA_ERROR for ConflictError and ValidationError and InternalError → error level', () => {
    expect(classifyRetrievalError(new ConflictError('dup', { operation: 't', code: 'C' })).level).toBe('error');
    expect(classifyRetrievalError(new ValidationError('bad', { operation: 't', code: 'V' })).level).toBe('error');
    expect(classifyRetrievalError(new InternalError('oops', { operation: 't', code: 'I' })).level).toBe('error');
    expect(classifyRetrievalError(new ConflictError('dup', { operation: 't', code: 'C' })).kind).toBe('DATA_ERROR');
  });

  it('UNKNOWN for null / undefined / non-Error throw', () => {
    expect(classifyRetrievalError(null).kind).toBe('UNKNOWN');
    expect(classifyRetrievalError(undefined).kind).toBe('UNKNOWN');
    expect(classifyRetrievalError('oops').kind).toBe('UNKNOWN');
    expect(classifyRetrievalError(42).kind).toBe('UNKNOWN');
    expect(classifyRetrievalError(null).level).toBe('error');
  });

  it('preserves the underlying cause on the classified record', () => {
    const e = new TypeError('fetch failed');
    const cls = classifyRetrievalError(e);
    expect(cls.cause).toBe(e);
  });
});

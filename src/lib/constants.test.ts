import { describe, it, expect } from 'vitest';
import {
  RATE_LIMIT,
  AUTH,
  HTTP,
  SSE,
  DEMO_ARRAY_MAX_SIZE,
  KNOWLEDGE_SEARCH_LIMIT,
  KNOWLEDGE_IMAGE_SEARCH_LIMIT,
} from './constants';

describe('RATE_LIMIT', () => {
  it('should have correct values', () => {
    expect(RATE_LIMIT.MESSAGE_MAX_PER_MINUTE).toBe(20);
    expect(RATE_LIMIT.KNOWLEDGE_IMPORT_MAX_PER_MINUTE).toBe(10);
    expect(RATE_LIMIT.UPLOAD_MAX_PER_MINUTE).toBe(30);
    expect(RATE_LIMIT.WINDOW_MS).toBe(60 * 1000);
  });
});

describe('AUTH', () => {
  it('should have correct login security values', () => {
    expect(AUTH.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(AUTH.LOGIN_LOCKOUT_MINUTES).toBe(15);
    expect(AUTH.PASSWORD_BCRYPT_ROUNDS).toBe(12);
    expect(AUTH.LOGIN_MAX_LOG_EVENTS).toBe(1000);
  });
});

describe('HTTP', () => {
  it('should have correct values', () => {
    expect(HTTP.KNOWLEDGE_MIN_SCORE).toBe(0.75);
    expect(HTTP.MAX_MESSAGE_LENGTH).toBe(10000);
    expect(HTTP.MAX_UPLOAD_SIZE_BYTES).toBe(20 * 1024 * 1024);
    expect(HTTP.JWT_COOKIE_NAME).toBe('sa_jwt');
    expect(HTTP.JWT_EXPIRES_IN).toBe(8 * 60 * 60);
  });
});

describe('SSE', () => {
  it('should have correct values', () => {
    expect(SSE.STREAM_TIMEOUT_MS).toBe(60 * 1000);
    expect(SSE.TIME_DIVIDER_GAP_MS).toBe(5 * 60 * 1000);
  });
});

describe('Demo array max size', () => {
  it('should be 200', () => {
    expect(DEMO_ARRAY_MAX_SIZE).toBe(200);
  });
});

describe('Knowledge search limits', () => {
  it('should have correct values', () => {
    expect(KNOWLEDGE_SEARCH_LIMIT).toBe(5);
    expect(KNOWLEDGE_IMAGE_SEARCH_LIMIT).toBe(3);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLogger,
  LogLevel,
  redactSensitiveFields,
  clearLoggerCache,
} from './logger';

describe('Logger', () => {
  beforeEach(() => {
    clearLoggerCache();
  });

  describe('createLogger', () => {
    it('should create a logger with module name', () => {
      const logger = createLogger('TestModule');
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should create a logger without module name', () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
    });

    it('should allow custom minimum level', () => {
      const logger = createLogger('TestModule', { minLevel: LogLevel.ERROR });
      expect(logger).toBeDefined();
    });
  });

  describe('redactSensitiveFields', () => {
    it('should redact email addresses', () => {
      const input = 'User email is test@example.com';
      const result = redactSensitiveFields(input);
      expect(result).toBe('User email is [EMAIL]');
    });

    it('should redact phone numbers', () => {
      const input = 'Call me at 13812345678';
      const result = redactSensitiveFields(input);
      expect(result).toBe('Call me at [PHONE]');
    });

    it('should redact tokens (JWT)', () => {
      const input = 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = redactSensitiveFields(input);
      expect(result).toContain('[REDACTED]');
    });

    it('should redact long hex strings', () => {
      const input = 'ID: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const result = redactSensitiveFields(input);
      expect(result).toContain('[HEX_TOKEN]');
    });

    it('should redact API keys when in key=value format', () => {
      const input = 'api_key=sk_test_1234567890abcdefghijklmnop';
      const result = redactSensitiveFields(input);
      expect(result).toContain('[REDACTED]');
    });

    it('should redact secrets when in key=value format', () => {
      const input = 'secret=supersecretvalue12345';
      const result = redactSensitiveFields(input);
      expect(result).toContain('[REDACTED]');
    });

    it('should handle objects with sensitive fields (keys not redacted, values are)', () => {
      const input = {
        name: 'John',
        email: 'john@example.com',
        secret: 'token=supersecretvalue12345',
      };
      const result = redactSensitiveFields(input) as Record<string, unknown>;
      expect(result.name).toBe('John');
      expect(result.email).toBe('[EMAIL]');
      // Note: The redact function only processes string values, not keys
      // So 'secret=xxx' as a value would be redacted
      expect(result.secret).toContain('[REDACTED]');
    });

    it('should handle arrays', () => {
      const input = ['email1@test.com', 'email2@test.com'];
      const result = redactSensitiveFields(input) as string[];
      expect(result[0]).toBe('[EMAIL]');
      expect(result[1]).toBe('[EMAIL]');
    });

    it('should return original string if no sensitive data found', () => {
      const input = 'Hello, world!';
      const result = redactSensitiveFields(input);
      expect(result).toBe('Hello, world!');
    });

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: 'John',
          contact: 'john@example.com',
        },
      };
      const result = redactSensitiveFields(input) as { user: { name: string; contact: string } };
      expect(result.user.name).toBe('John');
      expect(result.user.contact).toBe('[EMAIL]');
    });
  });
});

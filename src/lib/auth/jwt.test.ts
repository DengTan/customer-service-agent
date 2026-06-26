import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Set encryption key before importing crypto module
const mockJwtSecret = 'test-jwt-secret-key-that-is-long-enough-for-hs256';
process.env.JWT_SECRET = mockJwtSecret;
// @ts-expect-error - NODE_ENV is read-only but needed for test
process.env.NODE_ENV = 'test';

describe('JWT Utilities', () => {
  beforeAll(async () => {
    // JWT module is already imported with env vars set above
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  describe('generateToken', () => {
    it('should import and use generateToken', async () => {
      const { generateToken } = await import('./jwt');
      const token = generateToken({
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        avatar: null,
      });
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT format
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', async () => {
      const { generateToken, verifyToken } = await import('./jwt');
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        avatar: null,
      };
      const token = generateToken(payload);
      const result = verifyToken(token);
      expect(result).toBeDefined();
      expect(result?.sub).toBe(payload.sub);
      expect(result?.email).toBe(payload.email);
      expect(result?.role).toBe(payload.role);
    });

    it('should return null for invalid token', async () => {
      const { verifyToken } = await import('./jwt');
      const result = verifyToken('invalid.token.here');
      expect(result).toBeNull();
    });

    it('should return null for tampered token', async () => {
      const { generateToken, verifyToken } = await import('./jwt');
      const token = generateToken({
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        avatar: null,
      });
      // Tamper with the token
      const parts = token.split('.');
      parts[1] = 'tamperedPayload';
      const tamperedToken = parts.join('.');
      const result = verifyToken(tamperedToken);
      expect(result).toBeNull();
    });
  });

  describe('extractTokenFromCookies', () => {
    it('should extract token from cookie header', async () => {
      const { extractTokenFromCookies } = await import('./jwt');
      const cookieHeader = 'auth_token=valid.jwt.token; other_cookie=value';
      const token = extractTokenFromCookies(cookieHeader);
      expect(token).toBe('valid.jwt.token');
    });

    it('should return null if no token found', async () => {
      const { extractTokenFromCookies } = await import('./jwt');
      const cookieHeader = 'other_cookie=value; another=cookie';
      const token = extractTokenFromCookies(cookieHeader);
      expect(token).toBeNull();
    });

    it('should return null for empty cookie header', async () => {
      const { extractTokenFromCookies } = await import('./jwt');
      const token = extractTokenFromCookies('');
      expect(token).toBeNull();
    });

    it('should handle cookie with spaces', async () => {
      const { extractTokenFromCookies } = await import('./jwt');
      const cookieHeader = 'auth_token=token123; ';
      const token = extractTokenFromCookies(cookieHeader);
      expect(token).toBe('token123');
    });
  });
});

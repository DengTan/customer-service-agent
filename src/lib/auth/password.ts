/**
 * Password hashing utilities using bcrypt
 */

import bcrypt from 'bcryptjs';
import { AUTH } from '@/lib/constants';

/**
 * Hash a plain text password using bcrypt
 * @param password - Plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, AUTH.PASSWORD_BCRYPT_ROUNDS);
}

/**
 * Verify a plain text password against a hash
 * @param password - Plain text password to verify
 * @param hash - Hashed password to compare against
 * @returns True if password matches hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 * @param password - Password to validate
 * @returns Object with isValid and error message
 */
export function validatePasswordStrength(password: string): { isValid: boolean; error?: string } {
  if (password.length < 8) {
    return { isValid: false, error: '密码长度至少为 8 个字符' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: '密码需包含至少一个大写字母' };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: '密码需包含至少一个小写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: '密码需包含至少一个数字' };
  }
  return { isValid: true };
}

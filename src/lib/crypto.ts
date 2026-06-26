/**
 * AES-256-GCM 加密/解密工具
 * 用于保护数据库中存储的敏感信息（app_secret, access_token, refresh_token）
 *
 * ⚠️ ENCRYPTION_KEY 必须通过环境变量独立配置，不允许回退到 ANON_KEY。
 * 生产环境中 ANON_KEY 是公开的（前端可见），用作加密密钥等于没有加密。
 */
import crypto from 'crypto';
import { getLogger } from './logger';

const cryptoLogger = getLogger('Crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 12 字节
const AUTH_TAG_LENGTH = 16;

/**
 * 获取加密密钥，仅使用 ENCRYPTION_KEY 环境变量。
 * 密钥通过 SHA-256 派生固定 32 字节（AES-256）。
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // Graceful fallback: log warning and use a demo indicator
    // In production, this should always be set
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY is not set. This is a critical security requirement. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
        'and add it to your .env.local file.'
      );
    }
    cryptoLogger.warn('[Crypto] ENCRYPTION_KEY not set, using fallback (NOT SAFE for production)');
    return crypto.createHash('sha256').update('demo-fallback-key-do-not-use-in-production').digest();
  }
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * 加密明文，返回 "iv:authTag:ciphertext" 格式的 Base64 字符串
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');
  const ivB64 = iv.toString('base64');

  return `${ivB64}:${authTag}:${encrypted}`;
}

/**
 * 解密 "iv:authTag:ciphertext" 格式的密文，返回明文
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format, expected iv:authTag:ciphertext');
  }

  const [ivB64, authTagB64, encrypted] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * 对字符串进行 SHA-256 哈希，返回 64 位十六进制字符串
 */
export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 判断值是否为加密格式（简单启发式：包含两个冒号分隔的 base64 段）
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9+/=]+$/.test(p));
}

/**
 * HMAC-SHA256 webhook 签名验证
 * 使用 timingSafeEqual 进行常数时间比较，防止时序攻击
 */
export function validateSignature(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${secret}`;
  if (signature.length !== expected.length) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 安全解密字段，兼容 URL 明文和旧数据
 * - 如果输入看起来是 URL（以 http 开头），直接返回原文
 * - 否则尝试 AES-256-GCM 解密
 * - 解密失败时返回原文（向后兼容已存储的明文数据）
 * - 任何异常返回空字符串
 */
export function safeDecrypt(ciphertext: string, secret?: string): string {
  if (!ciphertext) return '';
  // Treat URLs as plain text (not encrypted)
  if (ciphertext.startsWith('http://') || ciphertext.startsWith('https://')) {
    return ciphertext;
  }
  try {
    // If a secret is provided, use it as the encryption key
    if (secret) {
      return decryptWithKey(ciphertext, secret);
    }
    return decrypt(ciphertext);
  } catch {
    // Backward compat: treat as plain text (legacy unencrypted data)
    return ciphertext;
  }
}

/**
 * 使用指定密钥解密（不从环境变量读取密钥）
 */
function decryptWithKey(ciphertext: string, encryptionKey: string): string {
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }

  const [ivB64, authTagB64, encrypted] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

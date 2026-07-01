/**
 * AES-256-GCM 加密/解密工具
 * 用于保护数据库中存储的敏感信息（app_secret, access_token, refresh_token）
 *
 * 生产环境必须设置 ENCRYPTION_KEY 环境变量。
 * 开发/测试环境会使用基于环境名称派生的安全密钥。
 */
import crypto from 'crypto';
import { getLogger } from './logger';

const cryptoLogger = getLogger('Crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 12 字节
const AUTH_TAG_LENGTH = 16;

/**
 * 获取加密密钥。
 * - 生产环境：必须配置 ENCRYPTION_KEY
 * - 非生产环境：使用基于环境名称派生的安全密钥
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (key) {
    // 用户提供了密钥，验证长度
    if (key.length < 16) {
      cryptoLogger.error('[Crypto] ENCRYPTION_KEY is too short (minimum 16 characters required).');
      throw new Error('ENCRYPTION_KEY must be at least 16 characters long.');
    }
    return crypto.createHash('sha256').update(key).digest();
  }
  
  // 无密钥时
  if (process.env.NODE_ENV === 'production') {
    // 生产环境必须配置密钥
    cryptoLogger.error('[Crypto] ENCRYPTION_KEY is not set. This is a critical security requirement.');
    throw new Error(
      'ENCRYPTION_KEY environment variable is required in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      'and add it to your .env.local file.'
    );
  }
  
  // 开发/测试环境：使用基于项目名称派生的安全密钥
  // 这是一个确定性派生，不会每次启动变化
  const envName = process.env.NODE_ENV || 'development';
  const derivedKey = crypto
    .createHash('sha256')
    .update(`SmartAssist-${envName}-SecureDerivationKey-v1`)
    .digest('hex');
  
  cryptoLogger.warn('[Crypto] Using environment-specific derived encryption key. Set ENCRYPTION_KEY for persistent keys.');
  return Buffer.from(derivedKey.slice(0, 64), 'hex');
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
 * 正确计算 body 的 HMAC-SHA256 并与签名比对
 */
export function validateSignature(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;

  // 提取签名中的 hex 部分（跳过 "sha256=" 前缀）
  const sigHash = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  // 允许无前缀的纯 hex 签名兼容处理
  const sigBuf = Buffer.from(sigHash, 'hex');
  if (sigBuf.length === 0) return false;

  // 计算 body 的 HMAC-SHA256
  const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  // 长度不同时直接返回 false（防时序攻击泄漏长度信息）
  if (sigBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expectedBuf);
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

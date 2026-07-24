/**
 * URL Utilities
 * Shared utilities for URL normalization and validation
 */

/**
 * Normalize LLM base URL to include full /v1/chat/completions path
 */
export function normalizeLlmBaseUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (!normalized.endsWith('/v1/chat/completions')) {
    if (!normalized.endsWith('/v1')) {
      normalized += '/v1/chat/completions';
    } else {
      normalized += '/chat/completions';
    }
  }
  return normalized;
}

/**
 * Check if hostname is a blocked internal address (basic SSRF protection)
 */
export function isBlockedHostname(hostname: string): boolean {
  const blockedPatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^localhost$/i,
    /^0\.0\.0\.0$/,
  ];
  return blockedPatterns.some(pattern => pattern.test(hostname));
}

/**
 * Normalize webhook/API URL
 */
export function normalizeApiUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  return normalized;
}

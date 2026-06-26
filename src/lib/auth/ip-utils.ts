/**
 * IP address extraction utilities
 */

/**
 * Extract client IP from request headers
 * Handles proxy/CDN scenarios (X-Forwarded-For, X-Real-IP)
 */
export function getIPFromRequest(request: Request): string {
  // Note: In Next.js middleware, use NextRequest.headers
  // In API routes, we need to handle the Request object
  const header = (request as { headers?: Headers }).headers;
  
  if (!header) return 'unknown';

  // Try X-Forwarded-For first (standard for proxies/CDNs)
  const xff = header.get('x-forwarded-for');
  if (xff) {
    // Take first IP in chain (original client)
    return xff.split(',')[0].trim();
  }

  // Try X-Real-IP (common with Nginx)
  const xreal = header.get('x-real-ip');
  if (xreal) {
    return xreal.trim();
  }

  // Fallback
  return 'unknown';
}

/**
 * Check if an IP is a private/internal IP
 */
export function isPrivateIP(ip: string): boolean {
  if (ip === 'unknown' || ip === 'localhost' || ip === '127.0.0.1') return true;
  
  return (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.') || // 172.16.x.x - 172.31.x.x
    ip.startsWith('::1') ||
    ip.startsWith('fc00:') || // IPv6 unique local
    ip.startsWith('fd00:')    // IPv6 unique local
  );
}

/**
 * Anonymize IP for logging (mask last octet for IPv4)
 */
export function anonymizeIP(ip: string): string {
  if (!ip || ip === 'unknown') return ip;
  
  // IPv4: mask last octet
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return ip.replace(/\.\d+$/, '.***');
  }
  
  // IPv6: mask last group
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length > 1) {
      parts[parts.length - 1] = '****';
      return parts.join(':');
    }
  }
  
  return ip;
}

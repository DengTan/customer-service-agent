/**
 * SSRF (Server-Side Request Forgery) protection module.
 *
 * Consolidates URL validation for outbound requests to user-supplied endpoints
 * (external knowledge base providers such as FastGPT). Replaces three duplicate
 * `isBlockedHostname` implementations that lived in `fastgpt-client.ts`,
 * `external-kb-probe.ts`, and the settings PUT route.
 *
 * Defenses covered:
 *   - RFC 1918 private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *   - Loopback (127.0.0.0/8, ::1)
 *   - Link-local (169.254.0.0/16, fe80::/10)
 *   - Carrier-grade NAT (100.64.0.0/10)
 *   - Broadcast / "this network" (0.0.0.0/8)
 *   - IPv6 unique-local (fc00::/7)
 *   - DNS rebinding / magic hosts (localtest.me, lvh.me, sslip.io, nip.io, vcap.me)
 *   - Hostname lookalikes for `localhost`
 *
 * NOTE: DNS-rebinding during the actual fetch is NOT prevented by static checks
 * alone. The production environment should also pin DNS resolution (e.g. via an
 * egress proxy) for full protection. This module is a best-effort defense that
 * catches the obvious cases.
 */
import { BlockList } from 'net';

const blockList = new BlockList();

// RFC 1918 private networks
blockList.addSubnet('10.0.0.0', 8, 'ipv4');
blockList.addSubnet('172.16.0.0', 12, 'ipv4');
blockList.addSubnet('192.168.0.0', 16, 'ipv4');
// Loopback
blockList.addSubnet('127.0.0.0', 8, 'ipv4');
// Link-local
blockList.addSubnet('169.254.0.0', 16, 'ipv4');
// CGNAT (RFC 6598)
blockList.addSubnet('100.64.0.0', 10, 'ipv4');
// "This network" / broadcast
blockList.addSubnet('0.0.0.0', 8, 'ipv4');

// IPv6 loopback
blockList.addSubnet('::1', 128, 'ipv6');
// IPv6 unique-local (fc00::/7)
blockList.addSubnet('fc00::', 7, 'ipv6');
// IPv6 link-local
blockList.addSubnet('fe80::', 10, 'ipv6');

/**
 * Hostnames known to resolve to the local machine (used to bypass DNS-based
 * SSRF checks against `localhost`).
 */
const LOCAL_MAGIC_DOMAINS = [
  'localtest.me',
  'lvh.me',
  'sslip.io',
  'nip.io',
  'vcap.me',
];

/**
 * Check whether the URL string targets a blocked (internal/local) address.
 *
 * @returns `true` if the URL should be rejected, `false` if it appears safe.
 */
export function isBlockedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Block `localhost` and any subdomain of it (`foo.localhost`)
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return true;
    }

    // Block magic domains used to spoof local resolution
    for (const d of LOCAL_MAGIC_DOMAINS) {
      if (hostname === d || hostname.endsWith('.' + d)) {
        return true;
      }
    }

    // IPv4 literal
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      if (blockList.check(hostname, 'ipv4')) {
        return true;
      }
    }

    // IPv6 literal (contains a colon and may be wrapped in brackets by URL parser)
    if (hostname.includes(':')) {
      const stripped = hostname.replace(/^\[|\]$/g, '');
      if (blockList.check(stripped, 'ipv6')) {
        return true;
      }
    }

    return false;
  } catch {
    // Invalid URL — treat as blocked (fail-closed).
    return true;
  }
}

/**
 * Validate an external service URL.
 *
 * Performs three checks in order:
 *   1. Protocol allow-list (http/https only)
 *   2. Optional HTTPS-only enforcement (used in production)
 *   3. SSRF check (rejects internal/loopback addresses)
 *
 * @returns `{ valid: true }` if safe, otherwise `{ valid: false, error }`.
 */
export function validateExternalUrl(
  urlString: string,
  options: { requireHttps?: boolean } = {},
): { valid: boolean; error?: string } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'URL 格式无效' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, error: '仅支持 HTTP/HTTPS 协议' };
  }

  if (options.requireHttps && url.protocol !== 'https:') {
    return { valid: false, error: '生产环境必须使用 HTTPS' };
  }

  if (isBlockedUrl(urlString)) {
    return { valid: false, error: '不允许访问内网地址' };
  }

  return { valid: true };
}

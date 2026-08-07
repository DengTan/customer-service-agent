import { describe, it, expect } from 'vitest';
import { isBlockedUrl, validateExternalUrl } from './ssrf-guard';

describe('SSRF Guard', () => {
  it('blocks localhost', () => {
    expect(isBlockedUrl('http://localhost')).toBe(true);
    expect(isBlockedUrl('http://LOCALHOST')).toBe(true);
    expect(isBlockedUrl('http://foo.localhost')).toBe(true);
  });

  it('blocks private IPv4', () => {
    expect(isBlockedUrl('http://10.0.0.1')).toBe(true);
    expect(isBlockedUrl('http://172.16.0.1')).toBe(true);
    expect(isBlockedUrl('http://192.168.1.1')).toBe(true);
  });

  it('blocks loopback', () => {
    expect(isBlockedUrl('http://127.0.0.1')).toBe(true);
    // 4-octet forms across the loopback range
    expect(isBlockedUrl('http://127.255.255.254')).toBe(true);
  });

  it('blocks link-local', () => {
    expect(isBlockedUrl('http://169.254.169.254')).toBe(true);
  });

  it('blocks CGNAT', () => {
    expect(isBlockedUrl('http://100.64.0.1')).toBe(true);
  });

  it('blocks magic domains', () => {
    expect(isBlockedUrl('http://localtest.me')).toBe(true);
    expect(isBlockedUrl('http://foo.sslip.io')).toBe(true);
  });

  it('allows valid public URLs', () => {
    expect(isBlockedUrl('https://fastgpt.cn')).toBe(false);
    expect(isBlockedUrl('https://api.example.com')).toBe(false);
  });

  it('requires HTTPS in production', () => {
    const result = validateExternalUrl('http://api.example.com', { requireHttps: true });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('HTTPS');
  });
});

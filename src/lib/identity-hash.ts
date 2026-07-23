/**
 * Sprint 6 — Identity hashing helpers for idempotency keys.
 *
 * The customer + conversation services need a stable, low-collision hash
 * for identity-shaped inputs (phone numbers, external platform IDs, etc.)
 * so that idempotency keys computed from those inputs are stable across
 * retries and don't expose PII in log lines.
 *
 * We use SHA-256 via Node's `crypto` (zero extra dependency) and render
 * the digest as lowercase hex. The output is 64 chars, which fits cleanly
 * into the existing `customer_create:${hash}` key pattern.
 *
 * Note: this is NOT a password hash — it's an identity fingerprint. We do
 * not salt because the inputs are already domain identifiers (phone,
 * external user id) and a hash collision is not a security event here.
 */

import { createHash } from 'node:crypto';

export interface IdentityHashInput {
  /** Phone number (digits only after normalization). */
  phone?: string | null;
  /** External platform user id (千牛 buyerOpenId, Web visitor_id, ...). */
  externalUserId?: string | null;
  /** Source platform discriminator (e.g. 'web' | 'qianniu' | 'doudian'). */
  source?: string | null;
  /** Platform connection id (separates cross-shop identities). */
  platformConnectionId?: string | null;
}

/**
 * Strip non-digit characters from a phone number. We are conservative:
 * leading + is dropped, all other non-digits are removed. Returns null
 * if no digits remain.
 */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  return digits.length > 0 ? digits : null;
}

/**
 * Build a stable identity fingerprint from a (phone, externalId, ...)
 * tuple. The output is a 64-char lowercase hex string. Empty / null parts
 * are omitted so that two callers with the same phone but different
 * external_ids produce different fingerprints (and vice versa).
 *
 * Algorithm:
 *   1. Normalize phone to digits-only.
 *   2. Lowercase external id (most platform IDs are case-sensitive, but we
 *      downcase for stability; mixed-case would still fingerprint the same
 *      user as different users which is a known limitation).
 *   3. Join parts with `|` (a separator that does not occur in normalized
 *      phone digits, external ids, or UUIDs).
 *   4. SHA-256 hex.
 */
export function hashCustomerIdentity(input: IdentityHashInput): string {
  const phone = normalizePhone(input.phone);
  const source = input.source?.trim().toLowerCase() ?? null;
  const external = input.externalUserId?.trim() ?? null;
  const connection = input.platformConnectionId?.trim() ?? null;

  const parts: string[] = [];
  if (phone) parts.push(`phone:${phone}`);
  if (source) parts.push(`source:${source}`);
  if (external) parts.push(`ext:${external}`);
  if (connection) parts.push(`conn:${connection}`);

  const joined = parts.length > 0 ? parts.join('|') : 'anonymous';
  return createHash('sha256').update(joined).digest('hex');
}
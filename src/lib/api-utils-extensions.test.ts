/**
 * Sprint 4 (T-3 / TS-3) — ticket DELETE ownership rules.
 *
 * Four cases:
 * - admin can delete any ticket
 * - creator can delete their own ticket
 * - someone else gets 403
 * - missing ticket gets 404 (no existence leak)
 *
 * These tests exercise the rules directly so we don't need a full request
 * pipeline. The route wires the same rules into the DELETE handler.
 */

import { describe, it, expect } from 'vitest';
import { requireResourceOwnership, type OwnershipDecision } from './api-utils';

// Either admin OR creator. Both branches return 'allow' independently so
// passing creators still works when role is 'agent'.
const adminOrCreatorRules = [
  ({ userRole, userId, resourceData }: { userRole: string | null; userId: string | null; resourceData: unknown }): OwnershipDecision => {
    if (userRole === 'admin') return 'allow';
    if (userId && resourceData && userId === resourceData) return 'allow';
    return { deny: 'admin or ticket creator only' };
  },
];

async function check(input: { resource: unknown; creator: string | null; userId: string | null; userRole: string | null }) {
  return requireResourceOwnership(
    input.resource,
    () => input.creator,
    adminOrCreatorRules,
    { userId: input.userId, userRole: input.userRole },
  );
}

describe('ticket DELETE ownership (T-3)', () => {
  it('allows an admin to delete any ticket', async () => {
    const deny = await check({ resource: { id: 't-1' }, creator: 'other-user', userId: 'u-admin', userRole: 'admin' });
    expect(deny).toBeNull();
  });

  it('allows the ticket creator to delete their own ticket', async () => {
    const deny = await check({ resource: { id: 't-1' }, creator: 'u-creator', userId: 'u-creator', userRole: 'agent' });
    expect(deny).toBeNull();
  });

  it('rejects a different user with 403', async () => {
    const deny = await check({ resource: { id: 't-1' }, creator: 'u-creator', userId: 'u-other', userRole: 'agent' });
    expect(deny).not.toBeNull();
    expect(deny!.status).toBe(403);
  });

  it('returns 404 for a missing ticket (no existence leak)', async () => {
    const deny = await check({ resource: null, creator: null, userId: 'u-any', userRole: 'admin' });
    expect(deny).not.toBeNull();
    expect(deny!.status).toBe(404);
    const body = await deny!.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.error).not.toMatch(/admin/);
  });

  it('treats missing user/role as unauthenticated (403)', async () => {
    const deny = await check({ resource: { id: 't-1' }, creator: 'u-x', userId: null, userRole: null });
    expect(deny).not.toBeNull();
    expect(deny!.status).toBe(403);
  });
});

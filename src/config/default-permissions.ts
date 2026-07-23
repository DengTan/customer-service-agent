/**
 * Default role permissions configuration
 * This file is the single source of truth for default permissions.
 * Used by both frontend (team-page.tsx) and backend (permission-service.ts).
 */

import type { UserRole, PermissionResource, PermissionAction } from '@/lib/types';

export type DefaultPermissions = Record<UserRole, Record<PermissionResource, Record<PermissionAction, boolean>>>;

export const DEFAULT_PERMISSIONS: DefaultPermissions = {
  admin: {
    conversations: { read: true, write: true, delete: true },
    knowledge: { read: true, write: true, delete: true },
    settings: { read: true, write: true, delete: true },
    team: { read: true, write: true, delete: true },
    customers: { read: true, write: true, delete: true },
    analytics: { read: true, write: true, delete: true },
    tickets: { read: true, write: true, delete: true },
    marketing: { read: true, write: true, delete: true },
    bots: { read: true, write: true, delete: true },
    sub_agents: { read: true, write: true, delete: true },
    routing: { read: true, write: true, delete: true },
    quality: { read: true, write: true, delete: true },
    push: { read: true, write: true, delete: true },
    auto_reply: { read: true, write: true, delete: true },
  },
  agent: {
    conversations: { read: true, write: true, delete: false },
    knowledge: { read: true, write: true, delete: false },
    settings: { read: true, write: false, delete: false },
    team: { read: true, write: false, delete: false },
    customers: { read: true, write: true, delete: false },
    analytics: { read: true, write: false, delete: false },
    tickets: { read: true, write: true, delete: false },
    marketing: { read: true, write: true, delete: false },
    bots: { read: true, write: false, delete: false },
    sub_agents: { read: true, write: false, delete: false },
    routing: { read: true, write: false, delete: false },
    quality: { read: true, write: false, delete: false },
    push: { read: true, write: false, delete: false },
    auto_reply: { read: true, write: true, delete: false },
  },
  observer: {
    conversations: { read: true, write: false, delete: false },
    knowledge: { read: true, write: false, delete: false },
    settings: { read: true, write: false, delete: false },
    team: { read: true, write: false, delete: false },
    customers: { read: true, write: false, delete: false },
    analytics: { read: true, write: false, delete: false },
    tickets: { read: true, write: false, delete: false },
    marketing: { read: true, write: false, delete: false },
    bots: { read: true, write: false, delete: false },
    sub_agents: { read: true, write: false, delete: false },
    routing: { read: true, write: false, delete: false },
    quality: { read: true, write: false, delete: false },
    push: { read: true, write: false, delete: false },
    auto_reply: { read: true, write: false, delete: false },
  },
};

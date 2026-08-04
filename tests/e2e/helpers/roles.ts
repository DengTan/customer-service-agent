/**
 * Role Definitions for E2E Auth Matrix Tests
 * Phase C2: E2E Authentication Matrix Framework
 */

export interface RoleConfig {
  email: string;
  password: string;
  displayName: string;
}

export const ROLES: Record<string, RoleConfig> = {
  admin: {
    email: 'admin@smartassist.com',
    password: 'Admin123456',
    displayName: 'Administrator',
  },
  agent: {
    email: 'agent@smartassist.com',
    password: 'Agent123456',
    displayName: 'Agent',
  },
  observer: {
    email: 'observer@smartassist.com',
    password: 'Observer123456',
    displayName: 'Observer',
  },
} as const;

export type RoleName = keyof typeof ROLES;

/**
 * Get role config by name
 */
export function getRoleConfig(role: RoleName): RoleConfig {
  const config = ROLES[role];
  if (!config) {
    throw new Error(`Unknown role: ${role}. Available roles: ${Object.keys(ROLES).join(', ')}`);
  }
  return config;
}

/**
 * All available role names
 */
export const ALL_ROLES = Object.keys(ROLES) as RoleName[];

/**
 * Roles that should have elevated permissions
 */
export const ADMIN_ROLES: RoleName[] = ['admin'];

/**
 * Roles that should have limited permissions
 */
export const LIMITED_ROLES: RoleName[] = ['agent', 'observer'];

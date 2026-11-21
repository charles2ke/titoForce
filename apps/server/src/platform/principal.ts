import type { AccessLevel, ObjectPermission, RolePermissions } from '@titoforce/shared';
import { forbidden } from '../util.ts';

export type PrincipalType = 'user' | 'agent' | 'automation' | 'approval' | 'system' | 'public';

/** Who is performing an operation. `permissions: null` means unrestricted system context. */
export interface Principal {
  type: PrincipalType;
  userId: string | null;
  name: string;
  permissions: RolePermissions | null;
  agentId?: string;
  /** Automation recursion depth. */
  depth?: number;
}

export const FULL_ACCESS: ObjectPermission = { read: 'all', create: true, edit: 'all', delete: 'all' };
export const NO_ACCESS: ObjectPermission = { read: 'none', create: false, edit: 'none', delete: 'none' };

export function systemPrincipal(name = 'System', type: PrincipalType = 'system', depth = 0): Principal {
  return { type, userId: null, name, permissions: null, depth };
}

export function objectPermission(principal: Principal, object: string): ObjectPermission {
  if (!principal.permissions) return FULL_ACCESS;
  return principal.permissions.objects[object] ?? principal.permissions.objects['*'] ?? NO_ACCESS;
}

function allows(level: AccessLevel, ownerId: string | null, principal: Principal): boolean {
  if (level === 'all') return true;
  if (level === 'own') return !!principal.userId && ownerId === principal.userId;
  return false;
}

export function canRead(principal: Principal, object: string, ownerId: string | null): boolean {
  return allows(objectPermission(principal, object).read, ownerId, principal);
}

export function assertCanReadObject(principal: Principal, object: string): AccessLevel {
  const level = objectPermission(principal, object).read;
  if (level === 'none') throw forbidden(`You do not have access to ${object} records`);
  return level;
}

export function assertCanCreate(principal: Principal, object: string): void {
  if (!objectPermission(principal, object).create) throw forbidden(`You cannot create ${object} records`);
}

export function assertCanEdit(principal: Principal, object: string, ownerId: string | null): void {
  if (!allows(objectPermission(principal, object).edit, ownerId, principal)) throw forbidden(`You cannot edit this ${object} record`);
}

export function assertCanDelete(principal: Principal, object: string, ownerId: string | null): void {
  if (!allows(objectPermission(principal, object).delete, ownerId, principal)) throw forbidden(`You cannot delete this ${object} record`);
}

export function canViewSensitive(principal: Principal): boolean {
  return !principal.permissions || principal.permissions.viewSensitive;
}

export function assertSetup(principal: Principal): void {
  if (principal.permissions && !principal.permissions.setup) throw forbidden('Administrator access is required');
}

export function assertManageAutomations(principal: Principal): void {
  if (principal.permissions && !principal.permissions.manageAutomations && !principal.permissions.setup) {
    throw forbidden('You cannot manage automations');
  }
}

export function assertManageAgents(principal: Principal): void {
  if (principal.permissions && !principal.permissions.manageAgents && !principal.permissions.setup) {
    throw forbidden('You cannot manage AI agents');
  }
}

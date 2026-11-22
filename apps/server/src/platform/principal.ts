import { type AccessLevel, type FieldAccess, type FieldDef, fieldAccess, type ObjectDef, type ObjectPermission, type RolePermissions } from '@titoforce/shared';
import { forbidden } from '../util.ts';

export type PrincipalType = 'user' | 'agent' | 'automation' | 'approval' | 'system' | 'public';

/** Who is performing an operation. `permissions: null` means unrestricted system context. */
export interface Principal {
  type: PrincipalType;
  userId: string | null;
  name: string;
  permissions: RolePermissions | null;
  /** Role of the user behind the principal; sharing rules share records with roles. */
  roleId?: string | null;
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

/**
 * Giving a record to another owner needs edit access to every record of the object, or ownership of the record.
 * Edit access from sharing rules is not enough: taking ownership would also grant delete access.
 */
export function canChangeOwner(principal: Principal, object: string, ownerId: string | null): boolean {
  if (!principal.permissions) return true;
  const perm = objectPermission(principal, object);
  if (perm.read === 'all' && perm.edit === 'all') return true;
  return perm.edit !== 'none' && !!principal.userId && ownerId === principal.userId;
}

export function assertCanReadObject(principal: Principal, object: string): AccessLevel {
  const level = objectPermission(principal, object).read;
  if (level === 'none') throw forbidden(`You do not have access to ${object} records`);
  return level;
}

export function assertCanCreate(principal: Principal, object: string): void {
  if (!objectPermission(principal, object).create) throw forbidden(`You cannot create ${object} records`);
}

/** The principal's field-level access: `edit`, `read` (read only) or `none` (hidden). */
export function fieldAccessOf(principal: Principal, object: string, field: Pick<FieldDef, 'apiName' | 'sensitive'>): FieldAccess {
  return fieldAccess(principal.permissions, object, field);
}

export function canSeeField(principal: Principal, object: string, field: Pick<FieldDef, 'apiName' | 'sensitive'>): boolean {
  return fieldAccessOf(principal, object, field) !== 'none';
}

/** The object definition without the fields hidden from the principal. */
export function visibleDef(principal: Principal, def: ObjectDef): ObjectDef {
  if (!principal.permissions) return def;
  const fields = def.fields.filter((f) => canSeeField(principal, def.apiName, f));
  if (fields.length === def.fields.length) return def;
  const visible = new Set(fields.map((f) => f.apiName));
  const keep = (list?: string[]) => list?.filter((f) => visible.has(f));
  const one = (f?: string) => (f && visible.has(f) ? f : undefined);
  return {
    ...def,
    fields,
    statusField: one(def.statusField),
    dateField: one(def.dateField),
    timeline: def.timeline && !(visible.has(def.timeline.start) && visible.has(def.timeline.end)) ? null : def.timeline,
    highlightFields: keep(def.highlightFields),
    listFields: keep(def.listFields),
    duplicateFields: keep(def.duplicateFields),
  };
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

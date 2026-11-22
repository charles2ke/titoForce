import type { FieldAccess, FieldDef, ObjectDef, RolePermissions, SsoProvider, SsoProviderType } from './types.ts';

/**
 * A role's access to a field. An explicit field permission wins. Otherwise sensitive fields are hidden from roles
 * without viewSensitive, and every other field is editable. `null` permissions mean system context (full access).
 * Roles with Setup access ignore field permissions: they manage permissions, so a restriction would not protect anything.
 */
export function fieldAccess(perms: RolePermissions | null | undefined, object: string, field: Pick<FieldDef, 'apiName' | 'sensitive'>): FieldAccess {
  if (!perms) return 'edit';
  const explicit = perms.setup ? undefined : perms.fields?.[object]?.[field.apiName];
  return explicit ?? (field.sensitive && !perms.viewSensitive ? 'none' : 'edit');
}

/** Fields whose values make up the record name. They cannot be hidden, because every user who can see a record sees its name. */
export function nameFieldNames(def: Pick<ObjectDef, 'nameField' | 'nameTemplate'>): string[] {
  if (def.nameTemplate) return [...def.nameTemplate.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((m) => m[1]!);
  return [def.nameField];
}

/**
 * Addresses of a single sign-on provider to register with the identity provider. `baseUrl` is the public address of
 * titoForce, without a trailing slash.
 */
export function ssoUrls(baseUrl: string, id: string, type: SsoProviderType, spEntityId?: string | null): SsoProvider['urls'] {
  const base = `${baseUrl}/api/auth/sso/${id}`;
  if (type === 'oidc') return { redirect: `${base}/callback` };
  return { acs: `${base}/acs`, entityId: spEntityId || `${base}/metadata`, metadata: `${base}/metadata` };
}

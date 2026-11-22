import type { FilterGroup, SharingRule } from '@titoforce/shared';
import { validateFilter } from '../automation/engine.ts';
import { type Db, parseJson, type SqlParam } from '../db/database.ts';
import { badRequest, conflict, newId, notFound, nowIso, placeholders } from '../util.ts';
import type { MetadataService } from './metadata.ts';
import type { Principal } from './principal.ts';
import { type BuildContext, filterSql } from './query-builder.ts';
import type { UserService } from './users.ts';

interface RuleRow {
  id: string;
  object_api_name: string;
  name: string;
  description: string;
  type: string;
  owner_roles: unknown;
  criteria: unknown;
  share_with: unknown;
  access: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function toRule(r: RuleRow): SharingRule {
  return {
    id: r.id,
    object: r.object_api_name,
    name: r.name,
    description: r.description,
    type: r.type === 'criteria' ? 'criteria' : 'owner',
    ownerRoles: parseJson<string[]>(r.owner_roles, []),
    criteria: parseJson<FilterGroup | null>(r.criteria, null),
    shareWith: parseJson<string[]>(r.share_with, []),
    access: r.access === 'edit' ? 'edit' : 'read',
    active: !!Number(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type SharingRuleInput = Pick<SharingRule, 'object' | 'name' | 'description' | 'type' | 'ownerRoles' | 'criteria' | 'shareWith' | 'access' | 'active'>;

export interface Predicate {
  sql: string;
  params: SqlParam[];
}

/**
 * SQL condition (on the `records` table) for records the user owns or that one of the rules shares. Criteria that no
 * longer compile, e.g. after a field was deleted, share nothing.
 */
export function sharedRecordsSql(ctx: BuildContext, userId: string | null, rules: SharingRule[]): Predicate {
  const parts = ['records.owner_id = ?'];
  const params: SqlParam[] = [userId ?? '-'];
  for (const rule of rules) {
    if (rule.type === 'owner') {
      if (!rule.ownerRoles.length) continue;
      parts.push(`records.owner_id IN (SELECT id FROM users WHERE role_id IN (${placeholders(rule.ownerRoles.length)}))`);
      params.push(...rule.ownerRoles);
    } else if (rule.criteria?.rules.length) {
      try {
        const f = filterSql(ctx, rule.criteria);
        parts.push(f.sql);
        params.push(...f.params);
      } catch {
        // skip rules that refer to deleted fields
      }
    }
  }
  return { sql: parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`, params };
}

/**
 * Sharing rules open up records to roles whose object access is limited to their own records: records owned by users
 * with certain roles, or records matching criteria. Rules never grant more than the role's object permissions allow,
 * and never grant delete.
 */
export class SharingService {
  private db: Db;
  private metadata: MetadataService;
  private users: UserService;

  constructor(db: Db, metadata: MetadataService, users: UserService) {
    this.db = db;
    this.metadata = metadata;
    this.users = users;
  }

  async list(object?: string): Promise<SharingRule[]> {
    const rows = object
      ? await this.db.all<RuleRow>('SELECT * FROM sharing_rules WHERE object_api_name = ? ORDER BY name', [object])
      : await this.db.all<RuleRow>('SELECT * FROM sharing_rules ORDER BY object_api_name, name');
    return rows.map(toRule);
  }

  async get(id: string): Promise<SharingRule> {
    const row = await this.db.get<RuleRow>('SELECT * FROM sharing_rules WHERE id = ?', [id]);
    if (!row) throw notFound('Sharing rule not found');
    return toRule(row);
  }

  /** Active rules that share records of the object with the principal's role. */
  async rulesFor(principal: Principal, object: string, db: Db = this.db): Promise<SharingRule[]> {
    const roleId = principal.roleId;
    if (!principal.permissions || !roleId) return [];
    const rows = await db.all<RuleRow>('SELECT * FROM sharing_rules WHERE object_api_name = ? AND active = 1', [object]);
    return rows.map(toRule).filter((r) => r.shareWith.includes(roleId));
  }

  async create(input: SharingRuleInput): Promise<SharingRule> {
    const v = await this.validate(input);
    const id = newId('shr');
    const now = nowIso();
    await this.db.run(
      `INSERT INTO sharing_rules (id, object_api_name, name, description, type, owner_roles, criteria, share_with, access, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, v.object, v.name, v.description, v.type, JSON.stringify(v.ownerRoles), v.criteria ? JSON.stringify(v.criteria) : null, JSON.stringify(v.shareWith), v.access, v.active ? 1 : 0, now, now],
    );
    return this.get(id);
  }

  async update(id: string, input: SharingRuleInput): Promise<SharingRule> {
    const current = await this.get(id);
    if (input.object !== current.object) throw badRequest('The object of a sharing rule cannot be changed');
    const v = await this.validate(input);
    await this.db.run(
      `UPDATE sharing_rules SET name = ?, description = ?, type = ?, owner_roles = ?, criteria = ?, share_with = ?, access = ?, active = ?, updated_at = ? WHERE id = ?`,
      [v.name, v.description, v.type, JSON.stringify(v.ownerRoles), v.criteria ? JSON.stringify(v.criteria) : null, JSON.stringify(v.shareWith), v.access, v.active ? 1 : 0, nowIso(), id],
    );
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const { changes } = await this.db.run('DELETE FROM sharing_rules WHERE id = ?', [id]);
    if (!changes) throw notFound('Sharing rule not found');
  }

  /** Rejects deleting a field that the criteria of a sharing rule use. */
  async assertFieldUnused(object: string, field: string): Promise<void> {
    const rule = (await this.list(object)).find((r) => r.criteria?.rules.some((c) => c.field === field));
    if (rule) throw conflict(`Sharing rule "${rule.name}" uses this field`);
  }

  private async validate(input: SharingRuleInput): Promise<SharingRuleInput> {
    const def = this.metadata.get(input.object);
    if (!def) throw badRequest(`Unknown object ${input.object}`);
    const name = input.name.trim();
    if (!name) throw badRequest('Name is required');
    const roles = new Set((await this.users.listRoles()).map((r) => r.id));
    const shareWith = [...new Set(input.shareWith)];
    const ownerRoles = input.type === 'owner' ? [...new Set(input.ownerRoles)] : [];
    for (const r of [...shareWith, ...ownerRoles]) if (!roles.has(r)) throw badRequest(`Unknown role ${r}`);
    if (!shareWith.length) throw badRequest('Choose the roles to share records with');
    let criteria: FilterGroup | null = null;
    if (input.type === 'owner') {
      if (!ownerRoles.length) throw badRequest('Choose the roles whose records are shared');
    } else {
      if (!input.criteria?.rules.length) throw badRequest('Add at least one condition');
      validateFilter(this.metadata, def.apiName, input.criteria);
      // Compile once so unsupported operators are reported now rather than silently sharing nothing.
      filterSql({ db: this.db, def, currentUserId: 'usr_check', now: new Date() }, input.criteria);
      criteria = { match: input.criteria.match, rules: input.criteria.rules };
    }
    return { ...input, name, description: input.description.trim(), ownerRoles, shareWith, criteria };
  }
}

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { RoleDef, RolePermissions, SessionInfo, UserDTO } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { AppError, badRequest, conflict, newId, notFound, nowIso } from '../util.ts';
import { type Challenge, type ChallengeStore, hashToken } from './challenges.ts';
import { invalidCode, type MfaService } from './mfa.ts';
import type { Principal } from './principal.ts';

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const AVATAR_COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'teal', 'indigo', 'red'];

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const MFA_LOGIN_TTL_MS = 5 * 60_000;
const MFA_SETUP_TTL_MS = 10 * 60_000;
const MFA_MAX_ATTEMPTS = 5;

export function rolePermissions(json: unknown): RolePermissions {
  return parseJson<RolePermissions>(json, { setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, objects: {} });
}

/** Result of the password step of signing in. */
export type LoginResult = { token: string; user: UserDTO } | { mfaRequired: true; challenge: string } | { mfaSetupRequired: true; challenge: string };

export type MfaChallengeKind = 'mfa_login' | 'mfa_setup';

const challengeExpired = () => new AppError(401, 'challenge_expired', 'Your sign-in attempt expired. Please sign in again.');

const EMPTY_SET: ReadonlySet<string> = new Set();

interface UserRow {
  id: string;
  email: string;
  name: string;
  title: string | null;
  password_hash: string | null;
  role_id: string;
  role_name: string;
  permissions: string;
  active: number;
  is_agent: number;
  avatar_color: string;
  created_at: string;
}

const USER_SELECT = `SELECT u.id, u.email, u.name, u.title, u.password_hash, u.role_id, r.name AS role_name, r.permissions,
  u.active, u.is_agent, u.avatar_color, u.created_at FROM users u JOIN roles r ON r.id = u.role_id`;

function toUser(row: UserRow): UserDTO {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    title: row.title,
    roleId: row.role_id,
    roleName: row.role_name,
    active: !!Number(row.active),
    isAgent: !!Number(row.is_agent),
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  };
}

export interface CreateUserInput {
  email: string;
  name: string;
  title?: string | null;
  roleId: string;
  password?: string | null;
  isAgent?: boolean;
  avatarColor?: string;
}

export class UserService {
  private db: Db;
  private mfa: MfaService;
  private challenges: ChallengeStore;
  /** Per object, the fields that at least one role cannot see; they are kept out of the search index. */
  private hiddenFields = new Map<string, Set<string>>();
  /** Called with the objects whose search-index exclusions changed (wired to re-index them). */
  onSearchFieldsChanged: ((objects: string[]) => Promise<void>) | null = null;

  constructor(db: Db, mfa: MfaService, challenges: ChallengeStore) {
    this.db = db;
    this.mfa = mfa;
    this.challenges = challenges;
  }

  async listRoles(): Promise<RoleDef[]> {
    const rows = await this.db.all<{ id: string; name: string; description: string; permissions: string }>('SELECT * FROM roles ORDER BY name');
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: rolePermissions(r.permissions) }));
  }

  fieldsHiddenFromSomeRole(object: string): ReadonlySet<string> {
    return this.hiddenFields.get(object) ?? EMPTY_SET;
  }

  /** Reloads which fields some role cannot see. Returns the objects whose set changed. */
  async refreshFieldRestrictions(): Promise<string[]> {
    const next = new Map<string, Set<string>>();
    for (const role of await this.listRoles()) {
      for (const [object, fields] of Object.entries(role.permissions.fields ?? {})) {
        for (const [field, access] of Object.entries(fields)) {
          if (access !== 'none') continue;
          let set = next.get(object);
          if (!set) next.set(object, (set = new Set()));
          set.add(field);
        }
      }
    }
    const same = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined) => (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every((x) => b?.has(x));
    const changed = [...new Set([...this.hiddenFields.keys(), ...next.keys()])].filter((o) => !same(this.hiddenFields.get(o), next.get(o)));
    this.hiddenFields = next;
    return changed;
  }

  private async fieldRestrictionsChanged(): Promise<void> {
    const changed = await this.refreshFieldRestrictions();
    if (changed.length && this.onSearchFieldsChanged) await this.onSearchFieldsChanged(changed);
  }

  /** Drops field-level settings for a deleted field, or for every field of a deleted object. */
  async removeFieldPermissions(object: string, field?: string): Promise<void> {
    for (const role of await this.listRoles()) {
      const fields = role.permissions.fields?.[object];
      if (!fields || (field !== undefined && !(field in fields))) continue;
      const nextFields = { ...role.permissions.fields };
      if (field === undefined) delete nextFields[object];
      else {
        const { [field]: _removed, ...rest } = fields;
        if (Object.keys(rest).length) nextFields[object] = rest;
        else delete nextFields[object];
      }
      await this.db.run('UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify({ ...role.permissions, fields: nextFields }), role.id]);
    }
    await this.fieldRestrictionsChanged();
  }

  async getRole(id: string): Promise<RoleDef | undefined> {
    return (await this.listRoles()).find((r) => r.id === id);
  }

  async upsertRole(role: RoleDef): Promise<RoleDef> {
    await this.db.run(
      `INSERT INTO roles (id, name, description, permissions) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, permissions = excluded.permissions`,
      [role.id, role.name, role.description, JSON.stringify(role.permissions)],
    );
    await this.fieldRestrictionsChanged();
    return role;
  }

  async deleteRole(id: string): Promise<void> {
    if (id === 'admin') throw badRequest('The administrator role cannot be deleted');
    if (!(await this.getRole(id))) throw notFound('Role not found');
    if (await this.db.get('SELECT id FROM users WHERE role_id = ? LIMIT 1', [id])) throw conflict('Move the users with this role to another role first');
    const rules = await this.db.all<{ name: string; owner_roles: string; share_with: string }>('SELECT name, owner_roles, share_with FROM sharing_rules ORDER BY name');
    const rule = rules.find((r) => parseJson<string[]>(r.owner_roles, []).includes(id) || parseJson<string[]>(r.share_with, []).includes(id));
    if (rule) throw conflict(`The sharing rule "${rule.name}" uses this role; change or delete the rule first`);
    const provider = await this.db.get<{ name: string }>('SELECT name FROM sso_providers WHERE default_role = ? LIMIT 1', [id]);
    if (provider) throw conflict(`Single sign-on provider "${provider.name}" gives this role to new users; change the provider first`);
    await this.db.run('DELETE FROM roles WHERE id = ?', [id]);
    await this.fieldRestrictionsChanged();
  }

  async listUsers(includeAgents = true): Promise<UserDTO[]> {
    const rows = await this.db.all<UserRow>(`${USER_SELECT} ${includeAgents ? '' : 'WHERE u.is_agent = 0'} ORDER BY u.name`);
    return rows.map(toUser);
  }

  async getUser(id: string): Promise<UserDTO | undefined> {
    const row = await this.db.get<UserRow>(`${USER_SELECT} WHERE u.id = ?`, [id]);
    return row ? toUser(row) : undefined;
  }

  async usersWithRole(roleId: string): Promise<UserDTO[]> {
    const rows = await this.db.all<UserRow>(`${USER_SELECT} WHERE u.role_id = ? AND u.active = 1`, [roleId]);
    return rows.map(toUser);
  }

  async createUser(input: CreateUserInput): Promise<UserDTO> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('A valid email is required');
    if (!input.name.trim()) throw badRequest('Name is required');
    if (!(await this.getRole(input.roleId))) throw badRequest(`Unknown role ${input.roleId}`);
    if (input.password != null && input.password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (await this.db.get('SELECT id FROM users WHERE email = ?', [email])) throw conflict(`A user with email ${email} already exists`);
    const id = newId('usr');
    const color = input.avatarColor ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
    await this.db.run(
      `INSERT INTO users (id, email, name, title, password_hash, role_id, active, is_agent, avatar_color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, email, input.name.trim(), input.title ?? null, input.password ? await hashPassword(input.password) : null, input.roleId, input.isAgent ? 1 : 0, color, nowIso()],
    );
    return (await this.getUser(id))!;
  }

  async updateUser(id: string, patch: { name?: string; title?: string | null; roleId?: string; active?: boolean; password?: string }): Promise<UserDTO> {
    const user = await this.getUser(id);
    if (!user) throw notFound('User not found');
    if (patch.roleId && !(await this.getRole(patch.roleId))) throw badRequest(`Unknown role ${patch.roleId}`);
    if (patch.password !== undefined && patch.password.length < 8) throw badRequest('Password must be at least 8 characters');
    await this.db.run('UPDATE users SET name = ?, title = ?, role_id = ?, active = ? WHERE id = ?', [
      patch.name?.trim() || user.name,
      patch.title === undefined ? user.title : patch.title,
      patch.roleId ?? user.roleId,
      patch.active === undefined ? (user.active ? 1 : 0) : patch.active ? 1 : 0,
      id,
    ]);
    if (patch.password !== undefined) await this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(patch.password), id]);
    if (patch.password !== undefined || patch.active === false) {
      await this.db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
      await this.challenges.revokeForUser(id);
    }
    return (await this.getUser(id))!;
  }

  /**
   * Password step of signing in. Users with two-factor authentication get a challenge to answer with a code;
   * users whose role requires it but who have not set it up get a challenge to enroll first.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const row = await this.db.get<UserRow>(`${USER_SELECT} WHERE u.email = ?`, [email.trim().toLowerCase()]);
    const ok = row ? await verifyPassword(password, row.password_hash) : await verifyPassword(password, 'scrypt$AAAA$AAAA');
    if (!row || !ok || !Number(row.active) || Number(row.is_agent)) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    if (await this.mfa.isEnabled(row.id)) return { mfaRequired: true, challenge: await this.challenges.create('mfa_login', row.id, {}, MFA_LOGIN_TTL_MS) };
    if (rolePermissions(row.permissions).requireMfa) {
      return { mfaSetupRequired: true, challenge: await this.challenges.create('mfa_setup', row.id, {}, MFA_SETUP_TTL_MS) };
    }
    return { token: await this.createSession(row.id), user: toUser(row) };
  }

  /** Starts a session for a user who has completed sign-in. Returns the session token. */
  async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.db.run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
    await this.db.run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      hashToken(token),
      userId,
      now.toISOString(),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    ]);
    return token;
  }

  /** A pending second-factor challenge of a user who can still sign in, or null. */
  async findMfaChallenge(token: string): Promise<(Challenge & { kind: MfaChallengeKind; userId: string; user: UserDTO }) | null> {
    const ch = (await this.challenges.find(token, 'mfa_login')) ?? (await this.challenges.find(token, 'mfa_setup'));
    if (!ch?.userId) return null;
    const user = await this.getUser(ch.userId);
    if (!user?.active || user.isAgent) return null;
    return { ...ch, kind: ch.kind as MfaChallengeKind, userId: ch.userId, user };
  }

  /**
   * Answers a second-factor challenge with an authenticator or recovery code (or, for a setup challenge, the first
   * code from the newly added authenticator). Returns a new session; setup also returns the recovery codes.
   */
  async completeMfaChallenge(ch: Challenge & { kind: MfaChallengeKind; userId: string }, code: string): Promise<{ token: string; recoveryCodes?: string[] }> {
    let recoveryCodes: string[] | undefined;
    try {
      if (ch.kind === 'mfa_login') {
        if (!(await this.mfa.verify(ch.userId, code))) throw invalidCode();
      } else {
        recoveryCodes = await this.mfa.completeEnrollment(ch.userId, code);
        await this.revokeOtherSessions(ch.userId);
      }
    } catch (err) {
      if (err instanceof AppError && err.code === 'invalid_code' && !(await this.challenges.fail(ch.id, MFA_MAX_ATTEMPTS))) {
        throw new AppError(401, 'challenge_expired', 'Too many incorrect codes. Please sign in again.');
      }
      throw err;
    }
    if (!(await this.challenges.consume(ch.id))) throw challengeExpired();
    // As when turning it on from settings: sessions that signed in without the new second factor end.
    if (ch.kind === 'mfa_setup') await this.revokeOtherSessions(ch.userId);
    return { token: await this.createSession(ch.userId), recoveryCodes };
  }

  /** Starts authenticator enrollment for a user who must set up two-factor authentication while signing in. */
  async beginChallengeEnrollment(token: string) {
    const ch = await this.challenges.find(token, 'mfa_setup');
    const user = ch?.userId ? await this.getUser(ch.userId) : undefined;
    if (!user?.active || user.isAgent) throw challengeExpired();
    return this.mfa.beginEnrollment(user.id, user.email);
  }

  async hasPassword(userId: string): Promise<boolean> {
    const row = await this.db.get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = ?', [userId]);
    return !!row?.password_hash;
  }

  async checkPassword(userId: string, password: string): Promise<void> {
    const row = await this.db.get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (!row || !(await verifyPassword(password, row.password_hash))) throw new AppError(400, 'invalid_password', 'Your password is incorrect');
  }

  /** Signs out every session of a user except the one with `keepToken`. */
  async revokeOtherSessions(userId: string, keepToken?: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, keepToken ? hashToken(keepToken) : '-']);
  }

  async logout(token: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
  }

  /** Self-service password change; signs out the user's other sessions and ends sign-ins that are waiting for a second factor. */
  async changePassword(userId: string, current: string, next: string, keepToken?: string): Promise<void> {
    const row = await this.db.get<UserRow>(`${USER_SELECT} WHERE u.id = ?`, [userId]);
    if (!row || !(await verifyPassword(current, row.password_hash))) throw new AppError(400, 'invalid_password', 'Your current password is incorrect');
    if (next.length < 8) throw badRequest('Password must be at least 8 characters');
    await this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), userId]);
    await this.revokeOtherSessions(userId, keepToken);
    await this.challenges.revokeForUser(userId);
  }

  async resolveSession(token: string): Promise<(SessionInfo & { principal: Principal }) | null> {
    const row = await this.db.get<UserRow & { expires_at: string }>(
      `${USER_SELECT} JOIN sessions s ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
      [hashToken(token), nowIso()],
    );
    if (!row) return null;
    const user = toUser(row);
    const permissions = rolePermissions(row.permissions);
    return { user, permissions, principal: { type: 'user', userId: user.id, name: user.name, roleId: row.role_id, permissions } };
  }

  async principalForUser(userId: string, type: Principal['type'] = 'user', nameOverride?: string): Promise<Principal> {
    const row = await this.db.get<UserRow>(`${USER_SELECT} WHERE u.id = ?`, [userId]);
    if (!row) throw notFound('User not found');
    return { type, userId: row.id, name: nameOverride ?? row.name, roleId: row.role_id, permissions: rolePermissions(row.permissions) };
  }

  /** The default owner for records created by system processes: the first active administrator. */
  async defaultOwnerId(): Promise<string | null> {
    const row = await this.db.get<{ id: string }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 AND u.is_agent = 0 AND r.id = 'admin' ORDER BY u.created_at LIMIT 1`,
    );
    return row?.id ?? null;
  }

  async agentUserId(): Promise<string | null> {
    const row = await this.db.get<{ id: string }>('SELECT id FROM users WHERE is_agent = 1 AND active = 1 ORDER BY created_at LIMIT 1');
    return row?.id ?? null;
  }
}

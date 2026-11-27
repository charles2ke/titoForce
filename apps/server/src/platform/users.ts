import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { RoleDef, RolePermissions, SessionInfo, UserDTO } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { AppError, badRequest, conflict, newId, notFound, nowIso } from '../util.ts';
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

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

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
  phone: string | null;
  created_at: string;
}

const USER_SELECT = `SELECT u.id, u.email, u.name, u.title, u.password_hash, u.role_id, r.name AS role_name, r.permissions,
  u.active, u.is_agent, u.avatar_color, u.phone, u.created_at FROM users u JOIN roles r ON r.id = u.role_id`;

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
    phone: row.phone ?? null,
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

  constructor(db: Db) {
    this.db = db;
  }

  async listRoles(): Promise<RoleDef[]> {
    const rows = await this.db.all<{ id: string; name: string; description: string; permissions: string }>('SELECT * FROM roles ORDER BY name');
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: parseJson<RolePermissions>(r.permissions, { setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, objects: {} }) }));
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
    return role;
  }

  async deleteRole(id: string): Promise<void> {
    if (id === 'admin') throw badRequest('The administrator role cannot be deleted');
    if (!(await this.getRole(id))) throw notFound('Role not found');
    if (await this.db.get('SELECT id FROM users WHERE role_id = ? LIMIT 1', [id])) throw conflict('Move the users with this role to another role first');
    await this.db.run('DELETE FROM roles WHERE id = ?', [id]);
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
    if (patch.password !== undefined) {
      await this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(patch.password), id]);
      await this.db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    }
    if (patch.active === false) await this.db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    return (await this.getUser(id))!;
  }

  /** The user's own phone number, used to bridge click-to-call and forward inbound calls. */
  async setPhone(userId: string, phone: string | null): Promise<UserDTO> {
    const value = phone?.trim() || null;
    if (value && !/^\+?[\d\s().-]{7,25}$/.test(value)) throw badRequest('Enter a phone number in international format, e.g. +1 415 555 0100');
    await this.db.run('UPDATE users SET phone = ? WHERE id = ?', [value, userId]);
    const user = await this.getUser(userId);
    if (!user) throw notFound('User not found');
    return user;
  }

  async login(email: string, password: string): Promise<{ token: string; user: UserDTO }> {
    const row = await this.db.get<UserRow>(`${USER_SELECT} WHERE u.email = ?`, [email.trim().toLowerCase()]);
    const ok = row ? await verifyPassword(password, row.password_hash) : await verifyPassword(password, 'scrypt$AAAA$AAAA');
    if (!row || !ok || !Number(row.active) || Number(row.is_agent)) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.db.run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
    await this.db.run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      hashToken(token),
      row.id,
      now.toISOString(),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    ]);
    return { token, user: toUser(row) };
  }

  async logout(token: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
  }

  /** Self-service password change; signs out the user's other sessions. */
  async changePassword(userId: string, current: string, next: string, keepToken?: string): Promise<void> {
    const row = await this.db.get<UserRow>(`${USER_SELECT} WHERE u.id = ?`, [userId]);
    if (!row || !(await verifyPassword(current, row.password_hash))) throw new AppError(400, 'invalid_password', 'Your current password is incorrect');
    if (next.length < 8) throw badRequest('Password must be at least 8 characters');
    await this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), userId]);
    await this.db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, keepToken ? hashToken(keepToken) : '-']);
  }

  async resolveSession(token: string): Promise<(SessionInfo & { principal: Principal }) | null> {
    const row = await this.db.get<UserRow & { expires_at: string }>(
      `${USER_SELECT} JOIN sessions s ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
      [hashToken(token), nowIso()],
    );
    if (!row) return null;
    const user = toUser(row);
    const permissions = parseJson<RolePermissions>(row.permissions, { setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, objects: {} });
    return { user, permissions, principal: { type: 'user', userId: user.id, name: user.name, permissions } };
  }

  async principalForUser(userId: string, type: Principal['type'] = 'user', nameOverride?: string): Promise<Principal> {
    const row = await this.db.get<UserRow>(`${USER_SELECT} WHERE u.id = ?`, [userId]);
    if (!row) throw notFound('User not found');
    const permissions = parseJson<RolePermissions>(row.permissions, { setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, objects: {} });
    return { type, userId: row.id, name: nameOverride ?? row.name, permissions };
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

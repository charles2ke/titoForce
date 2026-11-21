import { randomBytes } from 'node:crypto';
import type { UserDTO } from '@titoforce/shared';
import type { Services } from '../services.ts';
import { nowIso } from '../util.ts';
import { type DemoUserKey, type DemoUsers, seedDemoData } from './demo-data.ts';
import { standardObjects } from './objects.ts';
import { standardRoles } from './security.ts';
import { seedConfiguration } from './setup.ts';

/** Shared password of every demo login. Demo data is for evaluation only — never use it in production. */
export const DEMO_PASSWORD = 'titoforce';
export const DEMO_DOMAIN = 'titoforce.example';

export const DEMO_USERS: { key: DemoUserKey; name: string; title: string; roleId: string; color: string }[] = [
  { key: 'admin', name: 'Alex Morgan', title: 'CRM Administrator', roleId: 'admin', color: 'indigo' },
  { key: 'maria', name: 'Maria Garcia', title: 'VP of Sales', roleId: 'sales_manager', color: 'blue' },
  { key: 'james', name: 'James Chen', title: 'Account Executive', roleId: 'sales_rep', color: 'green' },
  { key: 'priya', name: 'Priya Patel', title: 'Account Executive', roleId: 'sales_rep', color: 'purple' },
  { key: 'sofia', name: 'Sofia Rossi', title: 'Support Lead', roleId: 'support_agent', color: 'teal' },
  { key: 'liam', name: "Liam O'Brien", title: 'Marketing Manager', roleId: 'marketing', color: 'pink' },
  { key: 'hannah', name: 'Hannah Kim', title: 'HR Director', roleId: 'hr_manager', color: 'orange' },
  { key: 'noah', name: 'Noah Williams', title: 'Software Engineer', roleId: 'employee', color: 'red' },
];

export interface DemoLogin {
  email: string;
  name: string;
  title: string;
  roleId: string;
}

export interface SeedResult {
  /** False when the database was already initialized. */
  seeded: boolean;
  demo: boolean;
  /** Set only when an admin password was generated; it is shown once in the server log. */
  generatedAdmin?: { email: string; password: string };
}

async function getSetting(s: Services, key: string): Promise<string | null> {
  return (await s.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))?.value ?? null;
}

async function setSetting(s: Services, key: string, value: string): Promise<void> {
  await s.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
}

/** Logins shown on the sign-in page; empty unless the demo company was seeded. */
export async function demoLogins(s: Services): Promise<DemoLogin[]> {
  if ((await getSetting(s, 'demo')) !== '1') return [];
  try {
    return JSON.parse((await getSetting(s, 'demo_logins')) ?? '[]') as DemoLogin[];
  } catch {
    return [];
  }
}

/**
 * Initializes an empty database: standard objects, roles, users, out-of-the-box configuration and
 * (unless disabled) a fictional demo company. Does nothing when the database was already seeded.
 */
export async function seedIfNeeded(s: Services, log: (msg: string) => void = () => {}): Promise<SeedResult> {
  if (await getSetting(s, 'seeded_at')) return { seeded: false, demo: (await getSetting(s, 'demo')) === '1' };
  const existing = await s.db.get<{ n: number }>('SELECT (SELECT COUNT(*) FROM roles) + (SELECT COUNT(*) FROM objects) AS n');
  if (Number(existing?.n ?? 0) > 0) {
    throw new Error('The database was only partially initialized (a previous seed failed). Run `npm run db:reset` to start over.');
  }
  const demo = s.config.seedDemo;
  log(demo ? 'Initializing database with the demo company…' : 'Initializing an empty database…');

  const objects = standardObjects();
  s.metadata.validateAll(objects);
  for (const def of objects) await s.metadata.saveObject(def);
  for (const role of standardRoles()) await s.users.upsertRole(role);

  let generatedAdmin: SeedResult['generatedAdmin'];
  const adminEmail = s.config.adminEmail ?? `admin@${DEMO_DOMAIN}`;
  let adminPassword = s.config.adminPassword ?? (demo ? DEMO_PASSWORD : null);
  if (!adminPassword) {
    adminPassword = randomBytes(12).toString('base64url');
    generatedAdmin = { email: adminEmail, password: adminPassword };
  }
  const logins: DemoLogin[] = [];
  const users = {} as DemoUsers;
  for (const u of DEMO_USERS) {
    if (!demo && u.key !== 'admin') continue;
    const isAdmin = u.key === 'admin';
    const email = isAdmin ? adminEmail : `${u.key}@${DEMO_DOMAIN}`;
    const password = isAdmin ? adminPassword : DEMO_PASSWORD;
    const created: UserDTO = await s.users.createUser({
      email,
      name: isAdmin && !demo ? 'Administrator' : u.name,
      title: u.title,
      roleId: u.roleId,
      password,
      avatarColor: u.color,
    });
    users[u.key] = created;
    if (demo && password === DEMO_PASSWORD) logins.push({ email: created.email, name: created.name, title: u.title, roleId: u.roleId });
  }
  await s.users.createUser({ email: `ai@${DEMO_DOMAIN}`, name: 'titoForce AI', title: 'Digital worker', roleId: 'ai_agent', isAgent: true, avatarColor: 'indigo' });

  const admin = await s.users.principalForUser(users.admin.id);
  const config = await seedConfiguration(s, admin, {
    sales: (users.maria ?? users.admin).id,
    hr: (users.hannah ?? users.admin).id,
  });

  if (demo) {
    await seedDemoData(s, users, config.processes);
    await s.notifications.notify(
      Object.values(users).map((u) => u.id),
      'Welcome to titoForce',
      'This is a demo company with fictional data. Ask the Copilot (✨) things like "show my open opportunities" or "qualify new leads".',
      '/',
    );
    await setSetting(s, 'demo_logins', JSON.stringify(logins));
  } else {
    await s.notifications.notify([users.admin.id], 'Welcome to titoForce', 'Start in Setup to invite users, then customize objects, automations and agents.', '/setup');
  }
  await setSetting(s, 'demo', demo ? '1' : '0');
  await setSetting(s, 'seeded_at', nowIso());
  log(`Database ready${demo ? ' (demo company loaded)' : ''}.`);
  return { seeded: true, demo, generatedAdmin };
}

import { randomUUID } from 'node:crypto';
import type { UserDTO } from '@titoforce/shared';
import pg from 'pg';
import { loadConfig } from '../src/config.ts';
import type { Principal } from '../src/platform/principal.ts';
import { DEMO_DOMAIN, seedIfNeeded } from '../src/seed/index.ts';
import { createServices, type ServiceOptions, type Services } from '../src/services.ts';
import { dropAllTenantDatabases } from '../src/tenancy/locator.ts';
import { Platform } from '../src/tenancy/platform.ts';

/**
 * Fresh database seeded with the demo company: in-memory SQLite, or a new schema in the PostgreSQL database named by
 * TITO_TEST_DATABASE_URL (dropped again by `close()`). Apart from that opt-in, only `env` is read, never the real
 * process environment.
 */
export async function createTestServices(opts: ServiceOptions & { env?: Record<string, string> } = {}): Promise<Services> {
  const { env, ...serviceOpts } = opts;
  const db = await testDatabase();
  const s = await createServices(loadConfig({ TITO_DATABASE_URL: db.url, TITO_SEED_DEMO: 'true', ...env }), serviceOpts);
  const closeServices = s.close.bind(s);
  s.close = async () => {
    await closeServices();
    await db.drop();
  };
  await seedIfNeeded(s);
  await s.jobs.drain();
  return s;
}

/**
 * A platform (organizations, sandboxes) whose default organization holds the demo company, on a fresh database like
 * `createTestServices`. `close()` also drops the databases of every organization created by the test.
 */
export async function createTestPlatform(opts: ServiceOptions & { env?: Record<string, string> } = {}): Promise<Platform> {
  const { env, ...serviceOpts } = opts;
  const db = await testDatabase();
  const config = loadConfig({ TITO_DATABASE_URL: db.url, TITO_SEED_DEMO: 'true', ...env });
  const platform = await Platform.open(config, serviceOpts);
  const closePlatform = platform.close.bind(platform);
  platform.close = async () => {
    await closePlatform();
    await dropAllTenantDatabases(config);
    await db.drop();
  };
  const s = await platform.servicesFor(platform.defaultTenant());
  await seedIfNeeded(s);
  await s.jobs.drain();
  return platform;
}

/** Each PostgreSQL test database is a new schema, so tests stay isolated like the in-memory SQLite default. */
async function testDatabase(): Promise<{ url: string; drop(): Promise<void> }> {
  const base = process.env.TITO_TEST_DATABASE_URL;
  if (!base) return { url: 'sqlite::memory:', drop: async () => {} };
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await withPg(base, `CREATE SCHEMA ${schema}`);
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return { url: url.toString(), drop: () => withPg(base, `DROP SCHEMA ${schema} CASCADE`) };
}

async function withPg(url: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function demoUser(s: Services, key: string): Promise<UserDTO> {
  const user = (await s.users.listUsers(false)).find((u) => u.email === `${key}@${DEMO_DOMAIN}`);
  if (!user) throw new Error(`Unknown demo user ${key}`);
  return user;
}

export async function principal(s: Services, key: string): Promise<Principal> {
  return s.users.principalForUser((await demoUser(s, key)).id);
}

import { rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import pg from 'pg';
import type { Config } from '../config.ts';
import { isPostgresUrl } from '../db/database.ts';

/**
 * Where each organization's database lives. Every organization gets its own database:
 * - SQLite: one file per organization next to the default database (`<name>-orgs/<id>-g<generation>.db`);
 * - PostgreSQL: one schema per organization in the default database (`<prefix>_<id>_g<generation>`, where the prefix
 *   is the schema of TITO_DATABASE_URL's `search_path` option, or "tito");
 * - in-memory SQLite (tests): a separate in-memory database per organization.
 * The default organization always uses TITO_DATABASE_URL itself, so single-organization installs are unchanged.
 * The generation changes when a sandbox is refreshed: a refresh builds the new database before dropping the old one.
 */

export const DEFAULT_TENANT_ID = 'default';
export const TENANT_ID_RE = /^[a-z0-9]{1,24}$/;

function sqliteFile(url: string): string {
  const file = url.startsWith('sqlite:') ? url.slice('sqlite:'.length) : url;
  return file || ':memory:';
}

export const isMemoryUrl = (url: string): boolean => !isPostgresUrl(url) && sqliteFile(url) === ':memory:';

/** Reads the schema from `options=-c search_path=x` in a PostgreSQL URL. */
function pgSchemaOf(url: string): string | null {
  const options = new URL(url).searchParams.get('options') ?? '';
  const m = /(?:^|\s)-c\s*search_path=(\S+)/.exec(options);
  return m ? m[1]!.split(',')[0]!.trim() : null;
}

function withoutSearchPath(url: string): string {
  const u = new URL(url);
  const options = (u.searchParams.get('options') ?? '').replace(/(?:^|\s)-c\s*search_path=\S+/g, '').trim();
  if (options) u.searchParams.set('options', options);
  else u.searchParams.delete('options');
  return u.toString();
}

function withSearchPath(url: string, schema: string): string {
  const u = new URL(withoutSearchPath(url));
  const options = u.searchParams.get('options');
  u.searchParams.set('options', `${options ? `${options} ` : ''}-c search_path=${schema}`);
  return u.toString();
}

const pgPrefix = (config: Config): string => pgSchemaOf(config.databaseUrl) ?? 'tito';
const tenantSchemaRe = (config: Config) => new RegExp(`^${pgPrefix(config)}_[a-z0-9]{1,24}_g\\d+$`);
const stem = (file: string) => basename(file, extname(file));

export function tenantDatabaseUrl(config: Config, tenantId: string, generation: number): string {
  if (tenantId === DEFAULT_TENANT_ID) return config.databaseUrl;
  if (!TENANT_ID_RE.test(tenantId)) throw new Error(`Invalid organization id ${tenantId}`);
  const base = config.databaseUrl;
  if (isPostgresUrl(base)) {
    const schema = `${pgPrefix(config)}_${tenantId}_g${generation}`;
    if (schema.length > 63) throw new Error(`Schema name ${schema} is too long`);
    return withSearchPath(base, schema);
  }
  if (isMemoryUrl(base)) return 'sqlite::memory:';
  return `sqlite:${join(tenantsDirectory(config)!, `${tenantId}-g${generation}.db`)}`;
}

/** Directory holding SQLite organization databases, or null for other storage. */
export function tenantsDirectory(config: Config): string | null {
  const base = config.databaseUrl;
  if (isPostgresUrl(base) || isMemoryUrl(base)) return null;
  const file = sqliteFile(base);
  return join(dirname(file), `${stem(file)}-orgs`);
}

async function withPgClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: withoutSearchPath(url) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Prepares an empty organization database (PostgreSQL: creates its schema; SQLite files are created on open). */
export async function ensureDatabase(config: Config, url: string): Promise<void> {
  if (url === config.databaseUrl || !isPostgresUrl(url)) return;
  const schema = pgSchemaOf(url);
  if (!schema || !tenantSchemaRe(config).test(schema)) throw new Error('Not an organization database');
  await withPgClient(url, (c) => c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`));
}

/** Permanently deletes an organization database (never the default one). */
export async function dropDatabase(config: Config, url: string): Promise<void> {
  // Every in-memory database is a separate one (gone once closed), so all of them share one URL.
  if (isMemoryUrl(url)) return;
  if (url === config.databaseUrl) throw new Error('Refusing to drop the default database');
  if (isPostgresUrl(url)) {
    const schema = pgSchemaOf(url);
    if (!schema || !tenantSchemaRe(config).test(schema)) throw new Error('Not an organization database');
    await withPgClient(url, (c) => c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
    return;
  }
  const file = sqliteFile(url);
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
}

/** PostgreSQL schemas of this installation's extra organizations (used by `db:reset` and test cleanup). */
export async function tenantSchemas(config: Config): Promise<string[]> {
  if (!isPostgresUrl(config.databaseUrl)) return [];
  const re = tenantSchemaRe(config);
  return withPgClient(config.databaseUrl, async (c) => {
    const r = await c.query<{ nspname: string }>('SELECT nspname FROM pg_namespace WHERE starts_with(nspname, $1)', [`${pgPrefix(config)}_`]);
    return r.rows.map((row) => row.nspname).filter((n) => re.test(n));
  });
}

/** Drops every extra-organization schema (PostgreSQL) or file (SQLite). */
export async function dropAllTenantDatabases(config: Config): Promise<number> {
  const dir = tenantsDirectory(config);
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    return 0;
  }
  const schemas = await tenantSchemas(config);
  if (schemas.length) await withPgClient(config.databaseUrl, async (c) => {
    for (const s of schemas) await c.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  });
  return schemas.length;
}

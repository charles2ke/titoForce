import { rmSync } from 'node:fs';
import { loadConfig, loadDotEnv } from '../config.ts';
import { isPostgresUrl, openDatabase } from '../db/database.ts';
import { TABLES } from '../db/schema.ts';
import { CONTROL_TABLES } from '../tenancy/control.ts';
import { dropAllTenantDatabases, tenantsDirectory } from '../tenancy/locator.ts';

// Deletes all titoForce data, including every additional organization and sandbox, so the next server start seeds a
// fresh database.
loadDotEnv();
const config = loadConfig();
const { databaseUrl } = config;

if (isPostgresUrl(databaseUrl)) {
  if (!process.argv.includes('--yes')) {
    console.error(
      'This drops every titoForce table and organization schema in the configured PostgreSQL database. Re-run with --yes to confirm:\n  npm run db:reset -- --yes',
    );
    process.exit(1);
  }
  const schemas = await dropAllTenantDatabases(config);
  const db = openDatabase(databaseUrl);
  for (const table of [...CONTROL_TABLES, ...[...TABLES].reverse()]) await db.exec(`DROP TABLE IF EXISTS ${table} CASCADE`);
  await db.close();
  console.log(`Dropped all titoForce tables${schemas ? ` and ${schemas} organization schema(s)` : ''}. Start the server to create and seed them again.`);
} else {
  const file = databaseUrl.startsWith('sqlite:') ? databaseUrl.slice('sqlite:'.length) : databaseUrl;
  if (!file || file === ':memory:') {
    console.log('In-memory database: nothing to reset.');
  } else {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
    const orgs = tenantsDirectory(config);
    if (orgs) rmSync(orgs, { recursive: true, force: true });
    console.log(`Deleted ${file}${orgs ? ` and ${orgs}` : ''}. Start the server to create and seed it again.`);
  }
}

import { rmSync } from 'node:fs';
import { loadConfig, loadDotEnv } from '../config.ts';
import { openDatabase } from '../db/database.ts';
import { TABLES } from '../db/schema.ts';

// Deletes all titoForce data so the next server start seeds a fresh database.
loadDotEnv();
const { databaseUrl } = loadConfig();

if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
  if (!process.argv.includes('--yes')) {
    console.error('This drops every titoForce table in the configured PostgreSQL database. Re-run with --yes to confirm:\n  npm run db:reset -- --yes');
    process.exit(1);
  }
  const db = openDatabase(databaseUrl);
  for (const table of [...TABLES].reverse()) await db.exec(`DROP TABLE IF EXISTS ${table} CASCADE`);
  await db.close();
  console.log('Dropped all titoForce tables. Start the server to create and seed them again.');
} else {
  const file = databaseUrl.startsWith('sqlite:') ? databaseUrl.slice('sqlite:'.length) : databaseUrl;
  if (!file || file === ':memory:') {
    console.log('In-memory database: nothing to reset.');
  } else {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
    console.log(`Deleted ${file}. Start the server to create and seed it again.`);
  }
}

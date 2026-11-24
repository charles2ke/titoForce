// Starts an isolated titoForce server for Playwright: a fresh database with the demo company and the offline
// AI rules engine, so runs are deterministic and never call an external LLM.
// The database is a temporary SQLite file, or a new schema in the PostgreSQL database named by E2E_DATABASE_URL.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..');
if (!existsSync(join(root, 'apps/web/dist/index.html'))) {
  console.error('apps/web/dist is missing: run `npm run build` before the end-to-end tests.');
  process.exit(1);
}

async function withPg(url: string, fn: (client: pg.Client) => Promise<unknown>): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

// Organizations created during the run (sign-up, sandboxes) have their own `<schema>_<id>_g<n>` schemas.
async function dropSchemas(client: pg.Client, schema: string): Promise<void> {
  const { rows } = await client.query<{ nspname: string }>('SELECT nspname FROM pg_namespace WHERE nspname = $1 OR starts_with(nspname, $2)', [schema, `${schema}_`]);
  for (const { nspname } of rows) await client.query(`DROP SCHEMA ${nspname} CASCADE`);
}

const dir = mkdtempSync(join(tmpdir(), 'titoforce-e2e-'));
const pgBase = process.env.E2E_DATABASE_URL;
const pgSchema = pgBase ? `e2e_${randomUUID().replaceAll('-', '')}` : null;
let databaseUrl = `sqlite:${join(dir, 'e2e.db')}`;
if (pgBase && pgSchema) {
  await withPg(pgBase, (c) => c.query(`CREATE SCHEMA ${pgSchema}`));
  const url = new URL(pgBase);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);
  databaseUrl = url.toString();
}

const child = spawn(process.execPath, [join(root, 'apps/server/src/index.ts')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    TITO_HOST: '127.0.0.1',
    TITO_PORT: process.env.E2E_PORT ?? '3457',
    TITO_DATABASE_URL: databaseUrl,
    TITO_SEED_DEMO: 'true',
    TITO_ADMIN_EMAIL: 'admin@titoforce.example',
    TITO_ADMIN_PASSWORD: 'titoforce',
    TITO_AI_PROVIDER: 'offline',
    TITO_ALLOW_SIGNUP: 'true',
    TITO_LOG_LEVEL: 'warn',
  },
});

child.on('exit', async (code, signal) => {
  rmSync(dir, { recursive: true, force: true });
  if (pgBase && pgSchema) await withPg(pgBase, (c) => dropSchemas(c, pgSchema)).catch((err: unknown) => console.error(`Could not drop schema ${pgSchema}:`, err));
  process.exit(code ?? (signal ? 1 : 0));
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));

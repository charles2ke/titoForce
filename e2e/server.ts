// Starts an isolated titoForce server for Playwright: a fresh database with the demo company and the offline
// AI rules engine, so runs are deterministic and never call an external LLM.
// The database is a temporary SQLite file, or a new schema in the PostgreSQL database named by E2E_DATABASE_URL.
// Integrations are configured against local stand-ins (e2e/fakes.ts) and made-up Google, Microsoft and Twilio
// credentials; the tests never let a request reach those services.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { EMAIL_FROM, GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID, SMTP_PORT, TWILIO } from './fakes.ts';

const root = resolve(import.meta.dirname, '..');
if (!existsSync(join(root, 'apps/web/dist/index.html'))) {
  console.error('apps/web/dist is missing: run `npm run build` before the end-to-end tests.');
  process.exit(1);
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

const dir = mkdtempSync(join(tmpdir(), 'titoforce-e2e-'));
const pgBase = process.env.E2E_DATABASE_URL;
const pgSchema = pgBase ? `e2e_${randomUUID().replaceAll('-', '')}` : null;
let databaseUrl = `sqlite:${join(dir, 'e2e.db')}`;
if (pgBase && pgSchema) {
  await withPg(pgBase, `CREATE SCHEMA ${pgSchema}`);
  const url = new URL(pgBase);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);
  databaseUrl = url.toString();
}

const port = process.env.E2E_PORT ?? '3457';
const child = spawn(process.execPath, [join(root, 'apps/server/src/index.ts')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    TITO_HOST: '127.0.0.1',
    TITO_PORT: port,
    TITO_DATABASE_URL: databaseUrl,
    TITO_SEED_DEMO: 'true',
    TITO_ADMIN_EMAIL: 'admin@titoforce.example',
    TITO_ADMIN_PASSWORD: 'titoforce',
    TITO_AI_PROVIDER: 'offline',
    TITO_LOG_LEVEL: 'warn',
    TITO_PUBLIC_URL: `http://127.0.0.1:${port}`,
    TITO_SECRET_KEY: 'e2e-secret-key-for-connected-account-credentials',
    TITO_SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`,
    TITO_EMAIL_FROM: EMAIL_FROM,
    TITO_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID,
    TITO_GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret',
    TITO_MICROSOFT_CLIENT_ID: MICROSOFT_CLIENT_ID,
    TITO_MICROSOFT_CLIENT_SECRET: 'e2e-microsoft-client-secret',
    TITO_TWILIO_ACCOUNT_SID: TWILIO.accountSid,
    TITO_TWILIO_AUTH_TOKEN: TWILIO.authToken,
    TITO_TWILIO_NUMBER: TWILIO.number,
    TITO_DEFAULT_CALLING_CODE: '1',
    // The calendar addresses the tests subscribe to are served from 127.0.0.1.
    TITO_ALLOW_PRIVATE_NETWORK: 'true',
  },
});

child.on('exit', async (code, signal) => {
  rmSync(dir, { recursive: true, force: true });
  if (pgBase && pgSchema) await withPg(pgBase, `DROP SCHEMA ${pgSchema} CASCADE`).catch((err: unknown) => console.error(`Could not drop schema ${pgSchema}:`, err));
  process.exit(code ?? (signal ? 1 : 0));
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));

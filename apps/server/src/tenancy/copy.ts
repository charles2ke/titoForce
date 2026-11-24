import type { SandboxType } from '@titoforce/shared';
import type { Db, Row, SqlParam } from '../db/database.ts';
import { TABLES } from '../db/schema.ts';

type Table = (typeof TABLES)[number];

/**
 * What a sandbox copies from its production organization. Developer sandboxes get configuration (and the users, so
 * people can sign in); full sandboxes also get every record and its history. Sessions are never copied.
 */
export const SANDBOX_COPY: Record<Exclude<Table, 'sessions' | 'schema_migrations'>, 'config' | 'data'> = {
  roles: 'config',
  users: 'config',
  objects: 'config',
  fields: 'config',
  records: 'data',
  lead_conversion_claims: 'data',
  record_history: 'data',
  list_views: 'config',
  apps: 'config',
  automations: 'config',
  automation_runs: 'data',
  approval_processes: 'config',
  approval_requests: 'data',
  agents: 'config',
  agent_runs: 'data',
  agent_actions: 'data',
  conversations: 'data',
  reports: 'config',
  dashboards: 'config',
  notifications: 'data',
  settings: 'config',
  page_layouts: 'config',
  translations: 'config',
};

/** Primary-key order used to page through each table (default "id"). */
const ORDER: Partial<Record<Table, string>> = {
  objects: 'api_name',
  fields: 'object_api_name, api_name',
  lead_conversion_claims: 'lead_id',
  settings: 'key',
  translations: 'locale, key',
};

const BATCH = 200;

/** JSON columns come back from PostgreSQL as objects; everything else is already a plain value. */
export const toParam = (v: unknown): SqlParam => (v !== null && typeof v === 'object' ? JSON.stringify(v) : (v as SqlParam));

async function insertRows(db: Db, table: string, rows: Row[]): Promise<void> {
  const columns = Object.keys(rows[0]!);
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  const params = rows.flatMap((row) => columns.map((c) => toParam(row[c])));
  await db.run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${rows.map(() => tuple).join(', ')}`, params);
}

export function sandboxTables(type: SandboxType): Table[] {
  return TABLES.filter((t): t is keyof typeof SANDBOX_COPY & Table => t in SANDBOX_COPY && (type === 'full' || SANDBOX_COPY[t as keyof typeof SANDBOX_COPY] === 'config'));
}

/**
 * Copies an organization into an empty, migrated database, reading the source in one consistent snapshot.
 * (On SQLite the snapshot holds the source database's lock, so production waits while a sandbox is copied.)
 */
export async function copyOrganization(source: Db, target: Db, type: SandboxType): Promise<{ rows: number }> {
  let rows = 0;
  await source.transaction(
    (src) =>
      target.transaction(async (dst) => {
        for (const table of sandboxTables(type)) {
          const order = ORDER[table] ?? 'id';
          for (let offset = 0; ; offset += BATCH) {
            const batch = await src.all<Row>(`SELECT * FROM ${table} ORDER BY ${order} LIMIT ? OFFSET ?`, [BATCH, offset]);
            if (batch.length) await insertRows(dst, table, batch);
            rows += batch.length;
            if (batch.length < BATCH) break;
          }
        }
      }),
    { snapshot: true },
  );
  return { rows };
}

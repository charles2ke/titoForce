import type { Db } from './database.ts';

/** Every table created by the migrations (used by the reset command; kept in sync by a test). */
export const TABLES = [
  'roles',
  'users',
  'sessions',
  'objects',
  'fields',
  'records',
  'lead_conversion_claims',
  'record_history',
  'list_views',
  'apps',
  'automations',
  'automation_runs',
  'approval_processes',
  'approval_requests',
  'agents',
  'agent_runs',
  'agent_actions',
  'conversations',
  'reports',
  'dashboards',
  'notifications',
  'settings',
  'schema_migrations',
] as const;

// Portable DDL: TEXT ids, ISO-8601 timestamps stored as TEXT, INTEGER booleans.
// Record payloads use JSON (TEXT in SQLite, JSONB in PostgreSQL).
const MIGRATIONS: { version: number; statements: (jsonType: string) => string[] }[] = [
  {
    version: 1,
    statements: (json) => [
      `CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL
      )`,
      `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        title TEXT,
        password_hash TEXT,
        role_id TEXT NOT NULL REFERENCES roles(id),
        active INTEGER NOT NULL DEFAULT 1,
        is_agent INTEGER NOT NULL DEFAULT 0,
        avatar_color TEXT NOT NULL DEFAULT 'blue',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      `CREATE TABLE objects (
        api_name TEXT PRIMARY KEY,
        definition TEXT NOT NULL,
        is_custom INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE fields (
        object_api_name TEXT NOT NULL REFERENCES objects(api_name) ON DELETE CASCADE,
        api_name TEXT NOT NULL,
        definition TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (object_api_name, api_name)
      )`,
      `CREATE TABLE records (
        id TEXT PRIMARY KEY,
        object_api_name TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        owner_id TEXT,
        data ${json} NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT
      )`,
      `CREATE INDEX idx_records_object ON records (object_api_name, updated_at)`,
      `CREATE INDEX idx_records_owner ON records (owner_id)`,
      `CREATE INDEX idx_records_name ON records (object_api_name, name)`,
      `CREATE TABLE record_history (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        object_api_name TEXT NOT NULL,
        event TEXT NOT NULL,
        changes TEXT,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_history_record ON record_history (record_id, created_at)`,
      `CREATE TABLE list_views (
        id TEXT PRIMARY KEY,
        object_api_name TEXT NOT NULL,
        name TEXT NOT NULL,
        owner_id TEXT,
        shared INTEGER NOT NULL DEFAULT 0,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE apps (
        id TEXT PRIMARY KEY,
        definition TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        object_api_name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        definition TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        record_id TEXT,
        status TEXT NOT NULL,
        detail TEXT,
        error TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_automation_runs ON automation_runs (automation_id, created_at)`,
      `CREATE TABLE approval_processes (
        id TEXT PRIMARY KEY,
        object_api_name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE approval_requests (
        id TEXT PRIMARY KEY,
        process_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        object_api_name TEXT NOT NULL,
        submitted_by TEXT NOT NULL,
        approver_id TEXT NOT NULL,
        status TEXT NOT NULL,
        comment TEXT,
        decision_comment TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      )`,
      `CREATE INDEX idx_approval_requests_approver ON approval_requests (approver_id, status)`,
      `CREATE INDEX idx_approval_requests_record ON approval_requests (record_id)`,
      `CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 1,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        steps TEXT NOT NULL,
        user_id TEXT,
        principal_id TEXT,
        record_id TEXT,
        conversation_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      )`,
      `CREATE INDEX idx_agent_runs_agent ON agent_runs (agent_id, created_at)`,
      `CREATE INDEX idx_agent_runs_record ON agent_runs (record_id)`,
      `CREATE TABLE agent_actions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        principal_id TEXT,
        approver_id TEXT,
        record_id TEXT,
        depth INTEGER NOT NULL DEFAULT 0,
        requested_at TEXT NOT NULL,
        decided_by TEXT,
        decided_at TEXT
      )`,
      `CREATE INDEX idx_agent_actions_status ON agent_actions (status, requested_at)`,
      `CREATE INDEX idx_agent_actions_run ON agent_actions (run_id)`,
      `CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        object_api_name TEXT NOT NULL,
        definition TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE dashboards (
        id TEXT PRIMARY KEY,
        definition TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_notifications_user ON notifications (user_id, read, created_at)`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    statements: () => [
      `CREATE TABLE lead_conversion_claims (
        lead_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE
      )`,
    ],
  },
];

export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set((await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => Number(r.version)));
  const jsonType = db.dialect === 'postgres' ? 'JSONB' : 'TEXT';
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of m.statements(jsonType)) await tx.exec(stmt);
      await tx.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
    });
  }
}

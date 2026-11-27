import type { Db, Dialect } from './database.ts';

/** Every table created by the migrations (used by the reset command; kept in sync by a test). */
export const TABLES = [
  'roles',
  'users',
  'sessions',
  'user_mfa',
  'auth_challenges',
  'sso_providers',
  'user_identities',
  'sharing_rules',
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
  'attachments',
  'attachment_contents',
  'contact_points',
  'connected_accounts',
  'oauth_states',
  'email_messages',
  'calls',
  'calendar_events',
  'calendar_feeds',
  'schema_migrations',
] as const;

// Portable DDL: TEXT ids, ISO-8601 timestamps stored as TEXT, INTEGER booleans.
// Record payloads use JSON (TEXT in SQLite, JSONB in PostgreSQL).
const MIGRATIONS: { version: number; statements: (jsonType: string, dialect: Dialect) => string[] }[] = [
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
  {
    // Multi-factor authentication, single sign-on and sharing rules.
    version: 4,
    statements: () => [
      `CREATE TABLE IF NOT EXISTS user_mfa (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        last_step INTEGER NOT NULL DEFAULT 0,
        recovery_codes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        enabled_at TEXT
      )`,
      // Short-lived sign-in state (second-factor steps, SSO requests); ids are SHA-256 hashes of the tokens.
      `CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL DEFAULT '{}',
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges (expires_at)`,
      `CREATE TABLE IF NOT EXISTS sso_providers (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL,
        secret TEXT,
        jit INTEGER NOT NULL DEFAULT 0,
        default_role TEXT REFERENCES roles(id),
        allowed_domains TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS user_identities (
        provider_id TEXT NOT NULL REFERENCES sso_providers(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT,
        PRIMARY KEY (provider_id, subject)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id)`,
      `CREATE TABLE IF NOT EXISTS sharing_rules (
        id TEXT PRIMARY KEY,
        object_api_name TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        owner_roles TEXT NOT NULL DEFAULT '[]',
        criteria TEXT,
        share_with TEXT NOT NULL DEFAULT '[]',
        access TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sharing_rules_object ON sharing_rules (object_api_name)`,
    ],
  },
  {
    // Integrations: file attachments, email, calendar and telephony.
    version: 3,
    statements: (json, dialect) => [
      `ALTER TABLE users ADD COLUMN phone TEXT`,
      `CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        source TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_attachments_record ON attachments (record_id, created_at)`,
      `CREATE TABLE attachment_contents (
        attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
        data ${dialect === 'postgres' ? 'BYTEA' : 'BLOB'} NOT NULL
      )`,
      // Email addresses and phone numbers of records, for matching mail, meetings and calls.
      `CREATE TABLE contact_points (
        record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        object_api_name TEXT NOT NULL,
        field TEXT NOT NULL,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (record_id, field)
      )`,
      `CREATE INDEX idx_contact_points_value ON contact_points (kind, value)`,
      `CREATE TABLE connected_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        address TEXT,
        settings ${json} NOT NULL,
        credentials TEXT,
        sync_state ${json} NOT NULL,
        status TEXT NOT NULL,
        last_sync_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_connected_accounts_user ON connected_accounts (user_id)`,
      `CREATE TABLE oauth_states (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      // No foreign key on activity_id: when an email activity is deleted, its row stays as a content-free tombstone,
      // so the message is not logged again by a later sync.
      `CREATE TABLE email_messages (
        id TEXT PRIMARY KEY,
        activity_id TEXT,
        account_id TEXT,
        user_id TEXT,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_key TEXT,
        in_reply_to TEXT,
        from_address TEXT NOT NULL,
        from_name TEXT,
        to_addresses ${json} NOT NULL,
        cc_addresses ${json} NOT NULL,
        subject TEXT NOT NULL,
        text_body TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_email_messages_activity ON email_messages (activity_id)`,
      // One row per message across all mailboxes: synced copies of a message are logged once.
      `CREATE UNIQUE INDEX idx_email_messages_message_id ON email_messages (message_id)`,
      `CREATE INDEX idx_email_messages_user ON email_messages (user_id, sent_at)`,
      `CREATE TABLE calls (
        id TEXT PRIMARY KEY,
        activity_id TEXT REFERENCES records(id) ON DELETE SET NULL,
        user_id TEXT,
        record_id TEXT,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_call_id TEXT,
        from_number TEXT,
        to_number TEXT,
        duration_seconds INTEGER,
        outcome TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_calls_activity ON calls (activity_id)`,
      `CREATE INDEX idx_calls_provider ON calls (provider, provider_call_id)`,
      // Calendar events logged as activities. No foreign keys: rows outlive deleted activities (tombstones) and removed
      // accounts (account_id cleared), so the same events are not imported again.
      `CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        user_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        activity_id TEXT,
        direction TEXT NOT NULL,
        fingerprint TEXT,
        options ${json} NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX idx_calendar_events_account ON calendar_events (account_id, external_id)`,
      `CREATE INDEX idx_calendar_events_activity ON calendar_events (activity_id)`,
      `CREATE INDEX idx_calendar_events_external ON calendar_events (external_id)`,
      `CREATE TABLE calendar_feeds (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      )`,
    ],
  },
];

export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set((await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => Number(r.version)));
  const jsonType = db.dialect === 'postgres' ? 'JSONB' : 'TEXT';
  // Version 3 existed independently on the security branch before integrations reached main.
  if (applied.has(3) && !applied.has(4)) {
    const table = db.dialect === 'postgres'
      ? await db.get("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'attachments'")
      : await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'");
    if (!table) {
      const integration = MIGRATIONS.find((m) => m.version === 3)!;
      await db.transaction(async (tx) => {
        for (const stmt of integration.statements(jsonType, db.dialect)) await tx.exec(stmt);
      });
    }
  }
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of m.statements(jsonType, db.dialect)) await tx.exec(stmt);
      await tx.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
    });
  }
}

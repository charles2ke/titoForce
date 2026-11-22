import type { DeploymentRecord, OrganizationKind, OrganizationStatus, SandboxType } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { type Migration, runMigrations } from '../db/schema.ts';

/** The control plane: tables in the default organization's database listing every organization (tenant) and deployment. */

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  kind: OrganizationKind;
  sandboxType: SandboxType | null;
  parentId: string | null;
  status: OrganizationStatus;
  /** Bumped by each sandbox refresh; part of the database location. */
  generation: number;
  /** Why provisioning or the last refresh failed. */
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  refreshedAt: string | null;
}

export const CONTROL_TABLES = ['platform_deployments', 'platform_tenants', 'platform_migrations'] as const;

const CONTROL_MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: () => [
      `CREATE TABLE platform_tenants (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        sandbox_type TEXT,
        parent_id TEXT,
        status TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        refreshed_at TEXT
      )`,
      `CREATE TABLE platform_deployments (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        target_id TEXT NOT NULL,
        deployed_by TEXT NOT NULL,
        components TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_platform_deployments_target ON platform_deployments (target_id, created_at)`,
    ],
  },
];

export function migrateControl(db: Db): Promise<void> {
  return runMigrations(db, CONTROL_MIGRATIONS, 'platform_migrations');
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  sandbox_type: string | null;
  parent_id: string | null;
  status: string;
  generation: number;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  refreshed_at: string | null;
}

export function toTenant(r: TenantRow): Tenant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind as OrganizationKind,
    sandboxType: (r.sandbox_type as SandboxType | null) ?? null,
    parentId: r.parent_id,
    status: r.status as OrganizationStatus,
    generation: Number(r.generation),
    error: r.error,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    refreshedAt: r.refreshed_at,
  };
}

export async function insertTenant(db: Db, t: Tenant): Promise<void> {
  await db.run(
    `INSERT INTO platform_tenants (id, slug, name, kind, sandbox_type, parent_id, status, generation, error, created_by, created_at, updated_at, refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.id, t.slug, t.name, t.kind, t.sandboxType, t.parentId, t.status, t.generation, t.error, t.createdBy, t.createdAt, t.updatedAt, t.refreshedAt],
  );
}

export async function updateTenant(db: Db, id: string, patch: Partial<Pick<Tenant, 'name' | 'status' | 'generation' | 'error' | 'refreshedAt'>>): Promise<void> {
  const cols: Record<string, string> = { name: 'name', status: 'status', generation: 'generation', error: 'error', refreshedAt: 'refreshed_at' };
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in cols)) continue;
    sets.push(`${cols[k]} = ?`);
    values.push(v as string | number | null);
  }
  sets.push('updated_at = ?');
  values.push(new Date().toISOString(), id);
  await db.run(`UPDATE platform_tenants SET ${sets.join(', ')} WHERE id = ?`, values);
}

interface DeploymentRow {
  id: string;
  source_id: string;
  source_name: string;
  target_id: string;
  deployed_by: string;
  components: string;
  status: string;
  error: string | null;
  created_at: string;
}

export function toDeployment(r: DeploymentRow): DeploymentRecord {
  return {
    id: r.id,
    sourceId: r.source_id,
    sourceName: r.source_name,
    targetId: r.target_id,
    deployedBy: r.deployed_by,
    components: parseJson<DeploymentRecord['components']>(r.components, []),
    status: r.status as DeploymentRecord['status'],
    error: r.error,
    createdAt: r.created_at,
  };
}

export async function insertDeployment(db: Db, d: DeploymentRecord): Promise<void> {
  await db.run(
    `INSERT INTO platform_deployments (id, source_id, source_name, target_id, deployed_by, components, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.id, d.sourceId, d.sourceName, d.targetId, d.deployedBy, JSON.stringify(d.components), d.status, d.error, d.createdAt],
  );
}

export async function listDeployments(db: Db, targetId: string, limit = 50): Promise<DeploymentRecord[]> {
  const rows = await db.all<DeploymentRow>('SELECT * FROM platform_deployments WHERE target_id = ? ORDER BY created_at DESC LIMIT ?', [targetId, limit]);
  return rows.map(toDeployment);
}

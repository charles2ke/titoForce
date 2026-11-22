import { randomBytes } from 'node:crypto';
import type { DeploymentRecord, OrganizationInfo, SandboxInfo, SandboxType } from '@titoforce/shared';
import type { Config } from '../config.ts';
import { type Db, openDatabase } from '../db/database.ts';
import { migrate } from '../db/schema.ts';
import { type SeedOptions, type SeedResult, seedIfNeeded } from '../seed/index.ts';
import { createServices, type ServiceOptions, type Services } from '../services.ts';
import { AppError, badRequest, conflict, nowIso } from '../util.ts';
import { tenantServices } from './context.ts';
import { insertDeployment, insertTenant, listDeployments, migrateControl, type Tenant, type TenantRow, toTenant, updateTenant } from './control.ts';
import { copyOrganization } from './copy.ts';
import { DEFAULT_TENANT_ID, dropDatabase, ensureDatabase, isMemoryUrl, tenantDatabaseUrl } from './locator.ts';

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const SANDBOX_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set([
  'default', 'www', 'api', 'app', 'apps', 'admin', 'platform', 'login', 'signup', 'static', 'assets', 'mail', 'email', 'help', 'support', 'status',
  'docs', 'blog', 'sandbox', 'test', 'demo', 'titoforce', 'system', 'root', 'auth', 'cdn', 'ws', 'realtime',
]);
export const MAX_SANDBOXES = 10;
/** Organizations without requests, realtime connections or background jobs for this long are closed (and reopened on demand). */
const IDLE_MS = 10 * 60_000;

interface Entry {
  generation: number;
  url: string;
  services: Promise<Services>;
  lastUsed: number;
}

export interface CreateOrganizationInput {
  slug: string;
  name: string;
  admin: { email: string; password: string; name: string };
  demo?: boolean;
  /** With demo data: let anyone sign in as the demo users with the shared demo password (operators only, never sign-up). */
  sampleLogins?: boolean;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newTenantId(): string {
  let id = '';
  for (const b of randomBytes(12)) id += ID_ALPHABET[b % 36];
  return id;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** Normalizes and validates an organization slug chosen at sign-up or by an operator. */
export function validateSlug(input: string): string {
  const slug = input.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || slug.includes('--')) {
    throw badRequest('Organization IDs use 1–32 lowercase letters, numbers and single hyphens, and start and end with a letter or number');
  }
  if (RESERVED_SLUGS.has(slug)) throw badRequest(`"${slug}" is reserved; choose another organization ID`);
  return slug;
}

/**
 * Every organization (tenant) has its own database and its own service graph, created on first use. The registry of
 * organizations lives in the default organization's database (the "control plane"); `single()` wraps one
 * pre-built service graph without a registry (tests and embedding).
 */
export class Platform {
  readonly config: Config;
  /** Services of the organization handling the current request (see tenancy/context.ts). */
  readonly services: Services = tenantServices();
  private control: Db | null;
  private opts: ServiceOptions;
  private tenants = new Map<string, Tenant>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private entries = new Map<string, Entry>();
  private operations = new Set<Promise<void>>();
  private sweeper: NodeJS.Timeout | null = null;
  /** Called for every service graph the platform opens (e.g. to attach realtime listeners). */
  private listeners: ((tenant: Tenant, services: Services) => void)[] = [];

  private constructor(config: Config, control: Db | null, opts: ServiceOptions) {
    this.config = config;
    this.control = control;
    this.opts = opts;
  }

  static async open(config: Config, opts: ServiceOptions = {}): Promise<Platform> {
    const defaults = await createServices(config, { ...opts, tenantId: DEFAULT_TENANT_ID });
    const p = new Platform(config, defaults.db, opts);
    try {
      await migrateControl(defaults.db);
      const now = nowIso();
      if (!(await defaults.db.get('SELECT id FROM platform_tenants WHERE id = ?', [DEFAULT_TENANT_ID]))) {
        await insertTenant(defaults.db, {
          ...blankTenant(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, config.defaultOrgName, now),
          kind: 'production',
          status: 'active',
          generation: 0,
        });
      }
      // Work interrupted by a restart: a refresh keeps its old (intact) database; a new sandbox has none.
      await defaults.db.run(`UPDATE platform_tenants SET status = 'active', error = ?, updated_at = ? WHERE status = 'refreshing'`, [
        'The last refresh was interrupted by a server restart',
        now,
      ]);
      await defaults.db.run(`UPDATE platform_tenants SET status = 'failed', error = ?, updated_at = ? WHERE status = 'provisioning'`, [
        'Provisioning was interrupted by a server restart; refresh the sandbox to try again',
        now,
      ]);
      await p.reload(true);
    } catch (err) {
      await defaults.close();
      throw err;
    }
    p.entries.set(DEFAULT_TENANT_ID, { generation: 0, url: config.databaseUrl, services: Promise.resolve(defaults), lastUsed: Date.now() });
    p.sweeper = setInterval(() => void p.sweep(), 60_000);
    p.sweeper.unref();
    return p;
  }

  /** One organization, no registry: organizations and sandboxes cannot be created. */
  static single(services: Services): Platform {
    const p = new Platform(services.config, null, {});
    p.tenants.set(DEFAULT_TENANT_ID, { ...blankTenant(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, services.config.defaultOrgName, nowIso()), status: 'active' });
    p.loadedAt = Number.POSITIVE_INFINITY;
    p.entries.set(DEFAULT_TENANT_ID, { generation: 0, url: services.config.databaseUrl, services: Promise.resolve(services), lastUsed: Date.now() });
    return p;
  }

  /** Whether organizations and sandboxes can be created (false for `single()`). */
  get multiTenant(): boolean {
    return this.control !== null;
  }

  onServices(listener: (tenant: Tenant, services: Services) => void): void {
    this.listeners.push(listener);
    for (const [id, entry] of this.entries) {
      void entry.services.then(
        (s) => {
          const tenant = this.tenants.get(id);
          if (tenant) listener(tenant, s);
        },
        () => {},
      );
    }
  }

  // ---------- Registry ----------

  /** Re-reads the registry at most every few seconds (other server processes may change it). */
  private async reload(force = false): Promise<void> {
    if (!this.control) return;
    if (!force && Date.now() - this.loadedAt < 5000) return;
    if (this.loading && !force) return this.loading;
    const control = this.control;
    const run = (async () => {
      const rows = await control.all<TenantRow>('SELECT * FROM platform_tenants');
      this.tenants = new Map(rows.map((r) => [r.id, toTenant(r)]));
      this.loadedAt = Date.now();
    })();
    this.loading = run;
    try {
      await run;
    } finally {
      if (this.loading === run) this.loading = null;
    }
  }

  async listTenants(): Promise<Tenant[]> {
    await this.reload();
    return [...this.tenants.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.slug.localeCompare(b.slug));
  }

  async tenantById(id: string): Promise<Tenant | null> {
    await this.reload();
    return this.tenants.get(id) ?? null;
  }

  async tenantBySlug(slug: string): Promise<Tenant | null> {
    await this.reload();
    const wanted = slug.trim().toLowerCase();
    for (const t of this.tenants.values()) if (t.slug === wanted) return t;
    return null;
  }

  defaultTenant(): Tenant {
    return this.tenants.get(DEFAULT_TENANT_ID)!;
  }

  /** Public description of an organization. */
  info(t: Tenant): OrganizationInfo {
    const parent = t.parentId ? this.tenants.get(t.parentId) : undefined;
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      kind: t.kind,
      sandboxType: t.sandboxType,
      parentId: t.parentId,
      parentSlug: parent?.slug ?? null,
      parentName: parent?.name ?? null,
      status: t.status,
      createdAt: t.createdAt,
      refreshedAt: t.refreshedAt,
    };
  }

  /** An organization as listed to the administrators of its production organization. */
  sandboxInfo(t: Tenant, createdByName: string | null = null): SandboxInfo {
    return { ...this.info(t), error: t.error, createdByName };
  }

  /** Throws unless the organization can serve requests. */
  assertAvailable(t: Tenant): void {
    if (t.status === 'active') return;
    if (t.status === 'suspended') throw new AppError(403, 'organization_suspended', `The organization "${t.name}" is suspended`);
    if (t.status === 'failed') throw new AppError(503, 'organization_unavailable', `The organization "${t.name}" could not be created: ${t.error ?? 'unknown error'}`);
    throw new AppError(503, 'organization_unavailable', `The organization "${t.name}" is being ${t.status === 'refreshing' ? 'refreshed' : 'prepared'}. Try again in a minute.`);
  }

  // ---------- Service graphs ----------

  async servicesFor(tenant: Tenant): Promise<Services> {
    let entry = this.entries.get(tenant.id);
    if (entry && entry.generation !== tenant.generation && this.multiTenant) {
      // Refreshed by another server process: switch to the new database.
      this.entries.delete(tenant.id);
      void entry.services.then((s) => s.close()).catch(() => {});
      entry = undefined;
    }
    if (!entry) {
      const url = tenantDatabaseUrl(this.config, tenant.id, tenant.generation);
      const created: Entry = { generation: tenant.generation, url, lastUsed: Date.now(), services: this.openServices(tenant, url) };
      this.entries.set(tenant.id, created);
      created.services.catch(() => {
        if (this.entries.get(tenant.id) === created) this.entries.delete(tenant.id);
      });
      entry = created;
    }
    entry.lastUsed = Date.now();
    return entry.services;
  }

  private async openServices(tenant: Tenant, url: string, db?: Db): Promise<Services> {
    if (!db) await ensureDatabase(this.config, url);
    const s = await createServices(
      { ...this.config, databaseUrl: url },
      { ...this.opts, tenantId: tenant.id, db, poolSize: tenant.id === DEFAULT_TENANT_ID ? undefined : this.config.tenantPoolSize },
    );
    for (const l of this.listeners) l(tenant, s);
    return s;
  }

  /** Closes organizations nobody has used for a while (their databases are reopened on the next request). */
  async sweep(now = Date.now(), idleMs = IDLE_MS): Promise<number> {
    let closed = 0;
    for (const [id, entry] of [...this.entries]) {
      if (id === DEFAULT_TENANT_ID || isMemoryUrl(entry.url) || now - entry.lastUsed < idleMs) continue;
      const s = await entry.services.catch(() => null);
      if (!s || this.entries.get(id) !== entry || now - entry.lastUsed < idleMs) continue;
      if (s.jobs.pending > 0 || s.realtime.connectionCount > 0) continue;
      this.entries.delete(id);
      await s.close().catch((err) => console.error(`[platform] closing ${id} failed`, err));
      closed++;
    }
    return closed;
  }

  // ---------- Organizations ----------

  private requireControl(): Db {
    if (!this.control) throw badRequest('Organizations and sandboxes are not available in this mode');
    return this.control;
  }

  /** Creates a production organization with its own database and administrator. */
  async createOrganization(input: CreateOrganizationInput, log?: (msg: string) => void): Promise<{ tenant: Tenant; services: Services; seed: SeedResult }> {
    const control = this.requireControl();
    const slug = validateSlug(input.slug);
    const name = input.name.trim();
    if (!name || name.length > 80) throw badRequest('Organization name is required (max 80 characters)');
    if (await this.tenantBySlug(slug)) throw conflict(`The organization ID "${slug}" is taken`);
    const tenant: Tenant = { ...blankTenant(newTenantId(), slug, name, nowIso()), kind: 'production', status: 'provisioning', generation: 1 };
    try {
      await insertTenant(control, tenant);
    } catch {
      throw conflict(`The organization ID "${slug}" is taken`);
    }
    await this.reload(true);
    const url = tenantDatabaseUrl(this.config, tenant.id, tenant.generation);
    try {
      await dropDatabase(this.config, url);
      const services = await this.servicesFor(tenant);
      const seedOpts: SeedOptions = {
        demo: !!input.demo,
        sampleLogins: !!input.sampleLogins,
        adminEmail: input.admin.email,
        adminPassword: input.admin.password,
        adminName: input.admin.name,
      };
      const seed = await seedIfNeeded(services, log, seedOpts);
      await updateTenant(control, tenant.id, { status: 'active' });
      await this.reload(true);
      return { tenant: this.tenants.get(tenant.id)!, services, seed };
    } catch (err) {
      await this.discard(tenant, url);
      throw err;
    }
  }

  /** Deletes an organization (and its sandboxes) together with its database. */
  async deleteOrganization(tenant: Tenant): Promise<void> {
    const control = this.requireControl();
    if (tenant.id === DEFAULT_TENANT_ID) throw badRequest('The default organization cannot be deleted');
    if (tenant.status === 'provisioning' || tenant.status === 'refreshing') throw conflict('Wait until the sandbox is ready, then delete it');
    for (const child of (await this.listTenants()).filter((t) => t.parentId === tenant.id)) await this.deleteOrganization(child);
    await updateTenant(control, tenant.id, { status: 'suspended' });
    await this.discard(tenant, tenantDatabaseUrl(this.config, tenant.id, tenant.generation));
  }

  async setSuspended(tenant: Tenant, suspended: boolean): Promise<Tenant> {
    const control = this.requireControl();
    if (tenant.id === DEFAULT_TENANT_ID && suspended) throw badRequest('The default organization cannot be suspended');
    if (suspended ? tenant.status !== 'active' : tenant.status !== 'suspended') throw conflict(`The organization is ${tenant.status}`);
    await updateTenant(control, tenant.id, { status: suspended ? 'suspended' : 'active' });
    await this.reload(true);
    return this.tenants.get(tenant.id)!;
  }

  private async discard(tenant: Tenant, url: string): Promise<void> {
    const entry = this.entries.get(tenant.id);
    this.entries.delete(tenant.id);
    if (entry) await (await entry.services.catch(() => null))?.close().catch(() => {});
    await dropDatabase(this.config, url).catch((err) => console.error(`[platform] dropping ${tenant.slug} failed`, err));
    await this.control?.run('DELETE FROM platform_tenants WHERE id = ?', [tenant.id]);
    await this.reload(true);
  }

  // ---------- Sandboxes ----------

  async sandboxesOf(parent: Tenant): Promise<Tenant[]> {
    return (await this.listTenants()).filter((t) => t.parentId === parent.id);
  }

  /** Starts copying a production organization into a new sandbox; poll the sandbox until it is active. */
  async createSandbox(parent: Tenant, input: { name: string; type: SandboxType }, createdBy: string): Promise<Tenant> {
    const control = this.requireControl();
    if (parent.kind !== 'production') throw badRequest('Sandboxes are created from a production organization');
    this.assertAvailable(parent);
    const label = input.name.trim();
    const name = label.toLowerCase();
    if (!SANDBOX_NAME_RE.test(name) || name.includes('--')) throw badRequest('Sandbox names use 1–20 letters, numbers and single hyphens');
    if (input.type !== 'developer' && input.type !== 'full') throw badRequest('Sandbox type must be "developer" or "full"');
    const slug = `${parent.slug}--${name}`;
    if (await this.tenantBySlug(slug)) throw conflict(`A sandbox named "${label}" already exists`);
    if ((await this.sandboxesOf(parent)).length >= MAX_SANDBOXES) throw conflict(`An organization can have at most ${MAX_SANDBOXES} sandboxes`);
    const tenant: Tenant = {
      ...blankTenant(newTenantId(), slug, label, nowIso()),
      kind: 'sandbox',
      sandboxType: input.type,
      parentId: parent.id,
      status: 'provisioning',
      generation: 1,
      createdBy,
    };
    try {
      await insertTenant(control, tenant);
    } catch {
      throw conflict(`A sandbox named "${label}" already exists`);
    }
    await this.reload(true);
    this.track(this.copyIntoSandbox(tenant, parent, tenant.generation, null));
    return tenant;
  }

  /** Replaces a sandbox's data and configuration with a fresh copy of production (everyone is signed out). */
  async refreshSandbox(sandbox: Tenant): Promise<Tenant> {
    const control = this.requireControl();
    if (sandbox.kind !== 'sandbox' || !sandbox.parentId) throw badRequest('Only sandboxes can be refreshed');
    if (sandbox.status !== 'active' && sandbox.status !== 'failed') throw conflict(`The sandbox is ${sandbox.status}`);
    const parent = await this.tenantById(sandbox.parentId);
    if (!parent) throw conflict('The production organization of this sandbox no longer exists');
    this.assertAvailable(parent);
    await updateTenant(control, sandbox.id, { status: 'refreshing', error: null });
    await this.reload(true);
    this.track(this.copyIntoSandbox(sandbox, parent, sandbox.generation + 1, sandbox.status === 'active' ? sandbox.generation : null));
    return this.tenants.get(sandbox.id)!;
  }

  private track(op: Promise<void>): void {
    this.operations.add(op);
    void op.finally(() => this.operations.delete(op));
  }

  /** Resolves once no sandbox is being created or refreshed. */
  async idle(): Promise<void> {
    while (this.operations.size) await Promise.allSettled([...this.operations]);
  }

  /** Builds generation `generation` of a sandbox from production, then switches the sandbox over to it. */
  private async copyIntoSandbox(sandbox: Tenant, parent: Tenant, generation: number, previous: number | null): Promise<void> {
    const control = this.control!;
    const url = tenantDatabaseUrl(this.config, sandbox.id, generation);
    let db: Db | null = null;
    try {
      await dropDatabase(this.config, url);
      await ensureDatabase(this.config, url);
      db = openDatabase(url, { poolSize: this.config.tenantPoolSize });
      await migrate(db);
      const source = await this.servicesFor(parent);
      await copyOrganization(source.db, db, sandbox.sandboxType ?? 'developer');
      const services = await this.openServices({ ...sandbox, generation }, url, db);
      db = null;
      const old = this.entries.get(sandbox.id);
      this.entries.set(sandbox.id, { generation, url, services: Promise.resolve(services), lastUsed: Date.now() });
      await updateTenant(control, sandbox.id, { status: 'active', generation, error: null, refreshedAt: nowIso() });
      await this.reload(true);
      if (old) await (await old.services.catch(() => null))?.close().catch(() => {});
      if (previous !== null) await dropDatabase(this.config, tenantDatabaseUrl(this.config, sandbox.id, previous)).catch(() => {});
    } catch (err) {
      console.error(`[platform] copying ${parent.slug} into ${sandbox.slug} failed`, err);
      await db?.close().catch(() => {});
      await dropDatabase(this.config, url).catch(() => {});
      const failedCreate = previous === null;
      await updateTenant(control, sandbox.id, {
        status: failedCreate ? 'failed' : 'active',
        error: `${failedCreate ? 'Copying production failed' : 'The refresh failed'}: ${errorText(err)}`,
      }).catch(() => {});
      await this.reload(true).catch(() => {});
    }
  }

  // ---------- Deployments ----------

  async recordDeployment(d: DeploymentRecord): Promise<void> {
    await insertDeployment(this.requireControl(), d);
  }

  /** The latest deployments into an organization, newest first. */
  async deploymentsTo(target: Tenant): Promise<DeploymentRecord[]> {
    return listDeployments(this.requireControl(), target.id);
  }

  async close(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.idle();
    const entries = [...this.entries.values()];
    this.entries.clear();
    // The default organization's database holds the registry, so it closes last.
    for (const entry of entries.reverse()) await (await entry.services.catch(() => null))?.close();
  }
}

function blankTenant(id: string, slug: string, name: string, now: string): Tenant {
  return {
    id,
    slug,
    name,
    kind: 'production',
    sandboxType: null,
    parentId: null,
    status: 'active',
    generation: 0,
    error: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    refreshedAt: null,
  };
}

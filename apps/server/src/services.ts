import { AgentService } from './ai/runtime.ts';
import { AnalyticsService } from './analytics/reports.ts';
import { ActionExecutor } from './automation/actions.ts';
import { ApprovalService } from './automation/approvals.ts';
import { AutomationService } from './automation/engine.ts';
import type { Config } from './config.ts';
import { type Db, openDatabase } from './db/database.ts';
import { migrate } from './db/schema.ts';
import { FormsService } from './modules/forms.ts';
import { HrService } from './modules/hr.ts';
import { SalesService } from './modules/sales.ts';
import { EventBus, JobQueue } from './platform/events.ts';
import { LayoutService } from './platform/layouts.ts';
import { MetadataService } from './platform/metadata.ts';
import { NotificationService } from './platform/notifications.ts';
import { RealtimeHub } from './platform/realtime.ts';
import { RecordService } from './platform/records.ts';
import { TranslationService } from './platform/translations.ts';
import { UserService } from './platform/users.ts';
import { AppService, ListViewService } from './platform/views.ts';
import { DEFAULT_TENANT_ID } from './tenancy/locator.ts';

export interface Services {
  config: Config;
  /** Organization the services belong to. */
  tenantId: string;
  db: Db;
  events: EventBus;
  jobs: JobQueue;
  metadata: MetadataService;
  users: UserService;
  notifications: NotificationService;
  records: RecordService;
  executor: ActionExecutor;
  automations: AutomationService;
  approvals: ApprovalService;
  analytics: AnalyticsService;
  views: ListViewService;
  apps: AppService;
  layouts: LayoutService;
  translations: TranslationService;
  sales: SalesService;
  hr: HrService;
  forms: FormsService;
  agents: AgentService;
  realtime: RealtimeHub;
  close(): Promise<void>;
}

export interface ServiceOptions {
  /** Used for LLM and webhook calls (tests inject fakes). */
  fetchImpl?: typeof fetch;
  jobConcurrency?: number;
  /** Organization these services belong to; its id prefixes session tokens so requests can be routed back to it. */
  tenantId?: string;
  /** An already open database (otherwise `config.databaseUrl` is opened). */
  db?: Db;
  /** PostgreSQL connection pool size. */
  poolSize?: number;
}

export async function createServices(config: Config, opts: ServiceOptions = {}): Promise<Services> {
  const db = opts.db ?? openDatabase(config.databaseUrl, { poolSize: opts.poolSize });
  await migrate(db);
  const s = await buildServices(config, db, opts);
  await s.agents.recoverInterrupted();
  return s;
}

/**
 * Wires the services on an open, migrated database without starting or recovering any work. Deployments also use it
 * on a transaction, to validate configuration against what the organization will look like after the deployment.
 */
export async function buildServices(config: Config, db: Db, opts: ServiceOptions = {}): Promise<Services> {
  const events = new EventBus();
  const jobs = new JobQueue(opts.jobConcurrency ?? 2);
  const realtime = new RealtimeHub();
  const metadata = new MetadataService(db);
  await metadata.load();
  const users = new UserService(db, opts.tenantId ?? DEFAULT_TENANT_ID);
  const notifications = new NotificationService(db);
  notifications.onCreated = (userId, n) => realtime.notify(userId, n);
  events.on(async (e) => realtime.recordChanged(e));
  const records = new RecordService(db, metadata, users, events);
  const executor = new ActionExecutor(records, metadata, users, notifications, jobs);
  if (opts.fetchImpl) executor.fetchImpl = opts.fetchImpl;
  const automations = new AutomationService(db, metadata, executor, events);
  // Registers itself as the executor's approval submitter.
  const approvals = new ApprovalService(db, metadata, records, users, notifications, executor, events);
  const analytics = new AnalyticsService(db, metadata, records);
  const views = new ListViewService(db, metadata);
  const apps = new AppService(db, metadata);
  const layouts = new LayoutService(db, metadata, users);
  const translations = new TranslationService(db, metadata, apps, layouts);
  metadata.onChange = () => {
    translations.invalidate();
    realtime.metadataChanged();
  };
  apps.onChange = () => realtime.metadataChanged();
  layouts.onChange = () => realtime.metadataChanged();
  translations.onChange = () => realtime.metadataChanged();
  const sales = new SalesService(db, metadata, records);
  const hr = new HrService(metadata, records);
  const forms = new FormsService(metadata, records);
  const agents = new AgentService(db, { records, metadata, users, approvals, notifications, sales, analytics }, jobs, config.ai, opts.fetchImpl);
  executor.launchAgent = (args) => agents.launchForRecord(args);
  automations.agentIds = () => agents.ids();

  return {
    config,
    tenantId: opts.tenantId ?? DEFAULT_TENANT_ID,
    db,
    events,
    jobs,
    metadata,
    users,
    notifications,
    records,
    executor,
    automations,
    approvals,
    analytics,
    views,
    apps,
    layouts,
    translations,
    sales,
    hr,
    forms,
    agents,
    realtime,
    async close() {
      await jobs.drain();
      realtime.close();
      await db.close();
    },
  };
}

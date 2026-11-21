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
import { MetadataService } from './platform/metadata.ts';
import { NotificationService } from './platform/notifications.ts';
import { RecordService } from './platform/records.ts';
import { UserService } from './platform/users.ts';
import { AppService, ListViewService } from './platform/views.ts';

export interface Services {
  config: Config;
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
  sales: SalesService;
  hr: HrService;
  forms: FormsService;
  agents: AgentService;
  close(): Promise<void>;
}

export interface ServiceOptions {
  /** Used for LLM and webhook calls (tests inject fakes). */
  fetchImpl?: typeof fetch;
  jobConcurrency?: number;
}

export async function createServices(config: Config, opts: ServiceOptions = {}): Promise<Services> {
  const db = openDatabase(config.databaseUrl);
  await migrate(db);
  const events = new EventBus();
  const jobs = new JobQueue(opts.jobConcurrency ?? 2);
  const metadata = new MetadataService(db);
  await metadata.load();
  const users = new UserService(db);
  const notifications = new NotificationService(db);
  const records = new RecordService(db, metadata, users, events);
  const executor = new ActionExecutor(records, metadata, users, notifications, jobs);
  if (opts.fetchImpl) executor.fetchImpl = opts.fetchImpl;
  const automations = new AutomationService(db, metadata, executor, events);
  // Registers itself as the executor's approval submitter.
  const approvals = new ApprovalService(db, metadata, records, users, notifications, executor, events);
  const analytics = new AnalyticsService(db, metadata, records);
  const views = new ListViewService(db, metadata);
  const apps = new AppService(db, metadata);
  const sales = new SalesService(db, metadata, records);
  const hr = new HrService(metadata, records);
  const forms = new FormsService(metadata, records);
  const agents = new AgentService(db, { records, metadata, users, approvals, notifications, sales, analytics }, jobs, config.ai, opts.fetchImpl);
  executor.launchAgent = (args) => agents.launchForRecord(args);
  automations.agentIds = () => agents.ids();
  await agents.recoverInterrupted();

  return {
    config,
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
    sales,
    hr,
    forms,
    agents,
    async close() {
      await jobs.drain();
      await db.close();
    },
  };
}

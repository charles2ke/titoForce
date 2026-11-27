import { AgentService } from './ai/runtime.ts';
import { AnalyticsService } from './analytics/reports.ts';
import { ActionExecutor } from './automation/actions.ts';
import { ApprovalService } from './automation/approvals.ts';
import { AutomationService } from './automation/engine.ts';
import type { Config } from './config.ts';
import { type Db, openDatabase } from './db/database.ts';
import { migrate } from './db/schema.ts';
import { IntegrationService } from './integrations/index.ts';
import type { ImapFactory, TransportFactory } from './integrations/types.ts';
import { FormsService } from './modules/forms.ts';
import { HrService } from './modules/hr.ts';
import { SalesService } from './modules/sales.ts';
import { ChallengeStore } from './platform/challenges.ts';
import { EventBus, JobQueue } from './platform/events.ts';
import { assertObjectChangeAllowed } from './platform/field-security.ts';
import { MetadataService } from './platform/metadata.ts';
import { MfaService } from './platform/mfa.ts';
import { NotificationService } from './platform/notifications.ts';
import { RecordService } from './platform/records.ts';
import { SecretBox } from './platform/secret-box.ts';
import { SharingService } from './platform/sharing.ts';
import { SsoService } from './platform/sso.ts';
import { UserService } from './platform/users.ts';
import { AppService, ListViewService } from './platform/views.ts';

export interface Services {
  config: Config;
  db: Db;
  events: EventBus;
  jobs: JobQueue;
  metadata: MetadataService;
  users: UserService;
  secrets: SecretBox;
  challenges: ChallengeStore;
  mfa: MfaService;
  sharing: SharingService;
  sso: SsoService;
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
  integrations: IntegrationService;
  close(): Promise<void>;
}

export interface ServiceOptions {
  /** Used for LLM, webhook, single sign-on and integration API calls (tests inject fakes). */
  fetchImpl?: typeof fetch;
  jobConcurrency?: number;
  /** SMTP and IMAP clients (tests inject fakes). */
  mailTransport?: TransportFactory;
  imapFactory?: ImapFactory;
}

export async function createServices(config: Config, opts: ServiceOptions = {}): Promise<Services> {
  const db = openDatabase(config.databaseUrl);
  await migrate(db);
  const events = new EventBus();
  const jobs = new JobQueue(opts.jobConcurrency ?? 2);
  const metadata = new MetadataService(db);
  await metadata.load();
  const secrets = new SecretBox(config.secretKey);
  const challenges = new ChallengeStore(db);
  const mfa = new MfaService(db, secrets);
  const users = new UserService(db, mfa, challenges);
  await users.refreshFieldRestrictions();
  metadata.validateChange = async (next) => assertObjectChangeAllowed(await users.listRoles(), metadata.list(), next);
  const sharing = new SharingService(db, metadata, users);
  const sso = new SsoService(db, users, secrets, challenges);
  if (opts.fetchImpl) sso.oidc.fetchImpl = opts.fetchImpl;
  const notifications = new NotificationService(db);
  const records = new RecordService(db, metadata, users, sharing, events);
  // Fields hidden from some role are kept out of the search index; re-index when that set changes.
  users.onSearchFieldsChanged = async (objects) => {
    for (const object of objects) if (metadata.get(object)) await records.reindexSearch(object);
  };
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
  const integrations = new IntegrationService(
    { db, cfg: config.integrations, metadata, records, users, notifications, jobs, events },
    { fetchImpl: opts.fetchImpl, mailTransport: opts.mailTransport, imapFactory: opts.imapFactory, warn: (message) => console.warn(message) },
  );
  await integrations.init();

  return {
    config,
    db,
    events,
    jobs,
    metadata,
    users,
    secrets,
    challenges,
    mfa,
    sharing,
    sso,
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
    integrations,
    async close() {
      integrations.stop();
      await jobs.drain();
      await db.close();
    },
  };
}

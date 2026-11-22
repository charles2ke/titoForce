import type { AdminIntegrationStatus, CrmRecord, EmailDetails, IntegrationProvider, IntegrationStatus, MeetingDetails, SyncResult, TimelineItem } from '@titoforce/shared';
import type { IntegrationsConfig } from '../config.ts';
import { type Db, parseJson } from '../db/database.ts';
import { backfillContactPoints } from '../platform/contact-points.ts';
import type { EventBus, JobQueue } from '../platform/events.ts';
import type { MetadataService } from '../platform/metadata.ts';
import type { NotificationService } from '../platform/notifications.ts';
import type { Principal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import type { UserService } from '../platform/users.ts';
import { AppError, chunk, placeholders } from '../util.ts';
import { type Account, AccountService } from './accounts.ts';
import { AttachmentService } from './attachments.ts';
import { attendeeList, CalendarService } from './calendar.ts';
import { SecretBox } from './crypto.ts';
import { defaultImapFactory, defaultTransportFactory, MailService } from './mail.ts';
import { errorMessage, ReconnectRequired, redirectUri } from './oauth.ts';
import { TelephonyService, toCallDetails } from './telephony.ts';
import type { ImapFactory, TransportFactory } from './types.ts';

/** How often the scheduler looks for accounts that are due a sync. */
const TICK_MS = 60_000;

export interface IntegrationDeps {
  db: Db;
  cfg: IntegrationsConfig;
  metadata: MetadataService;
  records: RecordService;
  users: UserService;
  notifications: NotificationService;
  jobs: JobQueue;
  events: EventBus;
}

export interface IntegrationOptions {
  fetchImpl?: typeof fetch;
  mailTransport?: TransportFactory;
  imapFactory?: ImapFactory;
  warn?: (message: string) => void;
}

/** Errors only the user can fix (revoked access, unreadable credentials, missing permission): scheduled syncs stop. */
const needsUser = (err: unknown): boolean =>
  err instanceof ReconnectRequired || (err instanceof AppError && (err.code === 'credentials_unreadable' || err.status === 401 || err.status === 403));

/** Email, calendars, telephony and files: the services, the sync scheduler, and timeline details. */
export class IntegrationService {
  readonly cfg: IntegrationsConfig;
  readonly secrets: SecretBox;
  readonly accounts: AccountService;
  readonly attachments: AttachmentService;
  readonly mail: MailService;
  readonly calendar: CalendarService;
  readonly telephony: TelephonyService;
  private db: Db;
  private metadata: MetadataService;
  private users: UserService;
  private jobs: JobQueue;
  private queued = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(deps: IntegrationDeps, opts: IntegrationOptions = {}) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    this.cfg = deps.cfg;
    this.db = deps.db;
    this.metadata = deps.metadata;
    this.users = deps.users;
    this.jobs = deps.jobs;
    this.secrets = new SecretBox(deps.db, deps.cfg.secretKey, deps.cfg.requireSecretKey);
    if (opts.warn) this.secrets.warn = opts.warn;
    this.accounts = new AccountService(deps.db, deps.cfg, this.secrets, fetchImpl);
    this.attachments = new AttachmentService(deps.db, deps.records, deps.cfg.attachmentMaxBytes);
    this.mail = new MailService({
      db: deps.db,
      cfg: deps.cfg,
      records: deps.records,
      users: deps.users,
      accounts: this.accounts,
      attachments: this.attachments,
      jobs: deps.jobs,
      events: deps.events,
      fetchImpl,
      transport: opts.mailTransport ?? defaultTransportFactory,
      imap: opts.imapFactory ?? defaultImapFactory,
    });
    this.calendar = new CalendarService({
      db: deps.db,
      cfg: deps.cfg,
      records: deps.records,
      users: deps.users,
      accounts: this.accounts,
      notifications: deps.notifications,
      jobs: deps.jobs,
      events: deps.events,
      fetchImpl,
    });
    this.telephony = new TelephonyService({ db: deps.db, cfg: deps.cfg, records: deps.records, users: deps.users, notifications: deps.notifications, fetchImpl });
    deps.records.enrichTimeline = (items, activities) => this.enrichTimeline(items, activities);
  }

  /** Indexes email addresses and phone numbers of existing records (once per database), and clears leftovers of deleted emails. */
  async init(): Promise<void> {
    await backfillContactPoints(this.db, this.metadata);
    await this.mail.forgetOrphans();
  }

  // ---------- status ----------

  async status(principal: Principal): Promise<IntegrationStatus> {
    const userId = principal.userId;
    const user = userId ? await this.users.getUser(userId) : undefined;
    let email: IntegrationStatus['email'] = { mode: 'log', accountId: null, from: null };
    if (userId && principal.type === 'user') {
      const channel = await this.mail.channel(userId);
      if (channel.mode === 'account') email = { mode: 'account', accountId: channel.account.id, from: channel.account.address };
      else if (channel.mode === 'relay') email = { mode: 'relay', accountId: null, from: this.cfg.emailFrom };
    }
    const twilio = this.cfg.twilio;
    return {
      email,
      oauth: { google: !!this.cfg.google, microsoft: !!this.cfg.microsoft },
      telephony: {
        twilio: !!twilio,
        phone: user?.phone ?? null,
        ready: !!twilio && !!user?.phone && !!this.telephony.e164(user.phone),
        number: twilio?.number ?? null,
      },
      calendarFeed: { enabled: userId ? await this.calendar.feedEnabled(userId) : false },
      syncIntervalMinutes: this.cfg.syncIntervalMinutes,
      attachmentMaxBytes: this.cfg.attachmentMaxBytes,
      allowPrivateNetwork: this.cfg.allowPrivateNetwork,
    };
  }

  async adminStatus(): Promise<AdminIntegrationStatus> {
    const rows = await this.db.all<{ provider: string; total: number; failing: number }>(
      `SELECT provider, COUNT(*) AS total, SUM(CASE WHEN status = 'error' OR last_error IS NOT NULL THEN 1 ELSE 0 END) AS failing
       FROM connected_accounts GROUP BY provider ORDER BY provider`,
    );
    const twilio = this.cfg.twilio;
    return {
      publicUrl: this.cfg.publicUrl,
      secretKey: this.secrets.configured,
      smtpRelay: { configured: !!(this.cfg.smtpUrl && this.cfg.emailFrom), from: this.cfg.emailFrom },
      google: !!this.cfg.google,
      microsoft: !!this.cfg.microsoft,
      twilio: {
        configured: !!twilio,
        number: twilio?.number ?? null,
        inboundWebhook: this.telephony.webhookUrl('voice'),
        statusWebhook: this.telephony.webhookUrl('status'),
      },
      oauthRedirects: { google: redirectUri(this.cfg, 'google'), microsoft: redirectUri(this.cfg, 'microsoft') },
      syncIntervalMinutes: this.cfg.syncIntervalMinutes,
      attachmentMaxBytes: this.cfg.attachmentMaxBytes,
      accounts: rows.map((r) => ({ provider: r.provider as IntegrationProvider, total: Number(r.total), failing: Number(r.failing ?? 0) })),
    };
  }

  // ---------- sync ----------

  /** Reads new mail and calendar events of an account now. Null when the account is gone or already syncing. */
  async syncAccount(id: string): Promise<SyncResult | null> {
    if (this.accounts.syncing.has(id)) return null;
    const account = await this.accounts.get(id);
    if (!account) return null;
    this.accounts.syncing.add(id);
    try {
      const errors: string[] = [];
      let stop = false;
      const attempt = async <T>(label: string, fn: (a: Account) => Promise<T>): Promise<T | null> => {
        try {
          return await fn(account);
        } catch (err) {
          stop ||= needsUser(err);
          errors.push(`${label}: ${errorMessage(err)}`);
          return null;
        }
      };
      const caps = this.accounts.capabilities(account);
      const mail = caps.syncEmail && account.settings.syncEmail ? await attempt('Email', (a) => this.mail.syncMail(a)) : null;
      const calendar = caps.calendar && account.settings.syncCalendar && !stop ? await attempt('Calendar', (a) => this.calendar.syncCalendar(a)) : null;
      const error = errors.length ? errors.join(' ') : null;
      await this.accounts.recordSync(id, error, stop);
      return { mail, calendar, error };
    } finally {
      this.accounts.syncing.delete(id);
    }
  }

  /** Queues a sync of the account unless one is queued or running. */
  enqueueSync(id: string): boolean {
    if (this.queued.has(id) || this.accounts.syncing.has(id)) return false;
    this.queued.add(id);
    this.jobs.enqueue(`sync:${id}`, async () => {
      try {
        await this.syncAccount(id);
      } finally {
        this.queued.delete(id);
      }
    });
    return true;
  }

  /** Queues syncs of the accounts that are due (active accounts of active users, after the sync interval). */
  async syncDue(now = Date.now()): Promise<number> {
    const before = new Date(now - this.cfg.syncIntervalMinutes * 60_000).toISOString();
    const rows = await this.db.all<{ id: string }>(
      `SELECT a.id FROM connected_accounts a JOIN users u ON u.id = a.user_id
       WHERE a.status = 'active' AND u.active = 1 AND (a.last_sync_at IS NULL OR a.last_sync_at < ?) ORDER BY a.last_sync_at`,
      [before],
    );
    let queued = 0;
    for (const r of rows) if (this.enqueueSync(r.id)) queued++;
    return queued;
  }

  /** Starts scheduled syncs (the server calls this once it is listening). An interval of 0 turns them off. */
  start(): void {
    if (this.timer || this.cfg.syncIntervalMinutes <= 0) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.syncDue();
    } catch (err) {
      console.error('[integrations] scheduling syncs failed', err);
    } finally {
      this.ticking = false;
    }
  }

  // ---------- timeline ----------

  /** Adds email, call, meeting and file details to the activities of a timeline (the caller checked read access). */
  async enrichTimeline(items: TimelineItem[], activities: CrmRecord[]): Promise<void> {
    const ids = activities.map((a) => a.id);
    const emails = new Map<string, EmailDetails>();
    const calls = new Map<string, ReturnType<typeof toCallDetails>>();
    const calendars = new Map<string, MeetingDetails['calendar']>();
    for (const part of chunk(ids, 300)) {
      const marks = placeholders(part.length);
      const emailRows = await this.db.all<{
        activity_id: string;
        direction: 'inbound' | 'outbound';
        status: EmailDetails['status'];
        provider: string;
        message_id: string;
        from_address: string;
        from_name: string | null;
        to_addresses: unknown;
        cc_addresses: unknown;
        subject: string;
        sent_at: string;
      }>(
        `SELECT activity_id, direction, status, provider, message_id, from_address, from_name, to_addresses, cc_addresses, subject, sent_at
         FROM email_messages WHERE activity_id IN (${marks})`,
        part,
      );
      for (const r of emailRows) {
        emails.set(r.activity_id, {
          direction: r.direction,
          status: r.status,
          from: r.from_address,
          fromName: r.from_name,
          to: parseJson<string[]>(r.to_addresses, []),
          cc: parseJson<string[]>(r.cc_addresses, []),
          subject: r.subject,
          sentAt: r.sent_at,
          messageId: r.message_id,
          provider: r.provider,
        });
      }
      const callRows = await this.db.all<Parameters<typeof toCallDetails>[0]>(
        `SELECT id, activity_id, user_id, record_id, direction, status, provider, provider_call_id, from_number, to_number, duration_seconds, outcome, started_at, ended_at
         FROM calls WHERE activity_id IN (${marks})`,
        part,
      );
      for (const r of callRows) if (r.activity_id) calls.set(r.activity_id, toCallDetails(r));
      const eventRows = await this.db.all<{ activity_id: string; direction: 'import' | 'export'; provider: string | null }>(
        `SELECT e.activity_id, e.direction, a.provider FROM calendar_events e LEFT JOIN connected_accounts a ON a.id = e.account_id WHERE e.activity_id IN (${marks})`,
        part,
      );
      for (const r of eventRows) calendars.set(r.activity_id, r.provider ? { provider: r.provider as IntegrationProvider, direction: r.direction } : null);
    }
    const files = await this.attachments.refsFor(ids);
    const byId = new Map(activities.map((a) => [a.id, a]));
    for (const item of items) {
      const id = item.recordId;
      const activity = id ? byId.get(id) : undefined;
      if (!id || !activity) continue;
      const email = emails.get(id);
      if (email) item.email = email;
      const call = calls.get(id);
      if (call) item.call = call;
      if (activity.fields.type === 'Meeting') {
        const f = activity.fields;
        item.meeting = {
          start: typeof f.start_time === 'string' ? f.start_time : null,
          end: typeof f.end_time === 'string' ? f.end_time : null,
          location: typeof f.location === 'string' ? f.location : null,
          attendees: attendeeList(f.attendees),
          calendar: calendars.get(id) ?? null,
        };
      }
      const refs = files.get(id);
      if (refs?.length) item.attachments = refs;
    }
  }
}

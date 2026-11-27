import type { CrmRecord, ImapAccountRequest, MailSyncStats, SendEmailRequest, SendEmailResult } from '@titoforce/shared';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import PostalMime, { type Email } from 'postal-mime';
import type { IntegrationsConfig } from '../config.ts';
import { type Db, parseJson } from '../db/database.ts';
import { matchContacts, normalizeEmail, readableMatch } from '../platform/contact-points.ts';
import type { EventBus, JobQueue } from '../platform/events.ts';
import { assertCanCreate, objectPermission, type Principal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import type { UserService } from '../platform/users.ts';
import { AppError, badRequest, chunk, conflict, forbidden, newId, nowIso, placeholders, RateLimiter, truncate } from '../util.ts';
import { type Account, type AccountService, internalAddresses, type PasswordCredentials, type StoredSettings, type SyncState } from './accounts.ts';
import type { AttachmentService, FileContent } from './attachments.ts';
import { sha256 } from './crypto.ts';
import { gmailSend, syncGmail } from './google.ts';
import { appendToSent, closeImap, mailServerError, openImap, smtpTransport, syncImap } from './imap.ts';
import { GRAPH_MAX_MIME_BYTES, graphSend, syncGraphMail } from './microsoft.ts';
import { buildMime, flattenAddresses, htmlToText, isAutomated, newMessageId, normalizeMessageId, parseReferences } from './mime.ts';
import { errorMessage } from './oauth.ts';
import type { Envelope, ImapFactory, IngestOutcome, MailFolder, MailSink, MailTransport, TransportFactory } from './types.ts';

export const defaultTransportFactory: TransportFactory = (options) => nodemailer.createTransport(options as never) as unknown as MailTransport;
export const defaultImapFactory: ImapFactory = (options) => new ImapFlow(options);

const MAX_RECIPIENTS = 50;
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_BODY = 100_000;
const DESCRIPTION_MAX = 32_000;
/** Messages read per account and sync run (the rest follow on the next run). */
const SYNC_BUDGET = 200;

export type Channel = { mode: 'account'; account: Account } | { mode: 'relay' } | { mode: 'log' };

interface MailContext {
  account: Account;
  principal: Principal;
  /** Addresses of the mailbox owner: their mail is outbound. */
  own: Set<string>;
  /** Addresses of all users and connected mailboxes: never matched as customers. */
  internal: Set<string>;
  stats: MailSyncStats;
}

interface MessageRow {
  activityId: string | null;
  accountId: string | null;
  userId: string | null;
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'received' | 'logged';
  provider: string;
  messageId: string;
  threadKey: string;
  inReplyTo: string | null;
  from: { address: string; name: string | null };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  sentAt: string;
}

export interface MailDeps {
  db: Db;
  cfg: IntegrationsConfig;
  records: RecordService;
  users: UserService;
  accounts: AccountService;
  attachments: AttachmentService;
  jobs: JobQueue;
  events: EventBus;
  fetchImpl: typeof fetch;
  transport: TransportFactory;
  imap: ImapFactory;
}

const cleanSubject = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 255);

function parseSentAt(value: string | null | undefined): string {
  const ms = Date.parse(value ?? '');
  // Missing dates and clocks far in the future would misplace the email on the timeline.
  return Number.isNaN(ms) || ms > Date.now() + 86_400_000 ? nowIso() : new Date(ms).toISOString();
}

function nameParts(name: string | null, address: string): { first_name?: string; last_name: string } {
  const words = (name ?? '').replace(/["']/g, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    const local = address.split('@')[0]!.split(/[._-]+/).filter(Boolean);
    words.push(...local.map((w) => w.charAt(0).toUpperCase() + w.slice(1)));
  }
  if (words.length < 2) return { last_name: (words[0] ?? address).slice(0, 80) };
  return { first_name: words.slice(0, -1).join(' ').slice(0, 80), last_name: words.at(-1)!.slice(0, 80) };
}

/** Sends email from the CRM, and logs synced mail as activities on the matching records. */
export class MailService {
  private d: MailDeps;
  private sendLimiter = new RateLimiter(60, 3_600_000);

  constructor(deps: MailDeps) {
    this.d = deps;
    deps.events.on(async (e) => {
      if (e.object === 'activity' && e.type === 'deleted') await this.forget(e.record.id);
    });
  }

  // ---------- sending ----------

  /** How mail from the user is delivered by default, or through a chosen account. */
  async channel(userId: string, accountId?: string | null): Promise<Channel> {
    if (accountId) {
      const account = await this.d.accounts.own(userId, accountId);
      if (!this.d.accounts.capabilities(account).sendEmail) throw badRequest(`${account.label} cannot send email`);
      return { mode: 'account', account };
    }
    const capable = (await this.d.accounts.list(userId)).filter((a) => this.d.accounts.capabilities(a).sendEmail);
    const account = capable.find((a) => a.status === 'active') ?? capable[0];
    if (account) return { mode: 'account', account };
    if (this.d.cfg.smtpUrl && this.d.cfg.emailFrom) return { mode: 'relay' };
    return { mode: 'log' };
  }

  async send(principal: Principal, input: SendEmailRequest): Promise<SendEmailResult> {
    if (principal.type !== 'user' || !principal.userId) throw forbidden('Only users can send email');
    const userId = principal.userId;
    const user = await this.d.users.getUser(userId);
    if (!user) throw forbidden('Only users can send email');
    // Checked before anything is sent, so a sent email can always be logged.
    const target = await this.d.records.get(principal, null, input.recordId);
    assertCanCreate(principal, 'activity');

    const addresses = (list: string[] | undefined, label: string) => [
      ...new Set(
        (list ?? [])
          .map((a) => a.trim())
          .filter(Boolean)
          .map((a) => {
            const n = normalizeEmail(a);
            if (!n) throw badRequest(`${label}: "${truncate(a, 80)}" is not a valid email address`);
            return n;
          }),
      ),
    ];
    const to = addresses(input.to, 'To');
    const cc = addresses(input.cc, 'Cc').filter((a) => !to.includes(a));
    if (!to.length) throw badRequest('Add at least one recipient');
    if (to.length + cc.length > MAX_RECIPIENTS) throw badRequest(`An email can have at most ${MAX_RECIPIENTS} recipients`);
    const subject = cleanSubject(input.subject);
    if (!subject) throw badRequest('Subject is required');
    const body = (input.body ?? '').replace(/\r\n?/g, '\n');
    if (body.length > MAX_BODY) throw badRequest(`The message can be at most ${MAX_BODY.toLocaleString('en-US')} characters`);

    const files: FileContent[] = [];
    for (const f of input.files ?? []) files.push({ fileName: f.fileName, contentType: f.contentType ?? '', data: this.d.attachments.decode(f.data) });
    for (const id of [...new Set(input.attachmentIds ?? [])]) {
      const f = await this.d.attachments.read(principal, id);
      files.push({ fileName: f.fileName, contentType: f.contentType, data: f.data });
    }
    if (files.length > MAX_FILES) throw badRequest(`An email can have at most ${MAX_FILES} attachments`);
    if (files.reduce((n, f) => n + f.data.length, 0) > MAX_TOTAL_BYTES) throw badRequest('Attachments can be at most 20 MB in total');

    let inReplyTo: string | null = null;
    let references: string[] = [];
    let threadKey: string | null = null;
    if (input.inReplyTo) {
      await this.d.records.get(principal, 'activity', input.inReplyTo);
      const parent = await this.d.db.get<{ message_id: string; thread_key: string | null }>('SELECT message_id, thread_key FROM email_messages WHERE activity_id = ?', [
        input.inReplyTo,
      ]);
      if (!parent) throw badRequest('Only emails can be answered');
      inReplyTo = parent.message_id;
      threadKey = parent.thread_key ?? parent.message_id;
      references = [...new Set([threadKey, parent.message_id])];
    }

    const channel = input.logOnly ? ({ mode: 'log' } as const) : await this.channel(userId, input.accountId);
    if (channel.mode === 'log' && !input.logOnly) {
      throw badRequest('Email sending is not set up: connect a mailbox in Settings, or ask an administrator to configure the SMTP relay. You can still log the email.');
    }
    if (channel.mode !== 'log' && !this.sendLimiter.hit(userId)) throw new AppError(429, 'rate_limited', 'You can send at most 60 emails per hour');

    const fromAddress = channel.mode === 'account' ? channel.account.address! : channel.mode === 'relay' ? this.d.cfg.emailFrom! : user.email;
    let messageId = newMessageId(fromAddress);
    const sentAt = nowIso();
    let provider = 'manual';
    if (channel.mode !== 'log') {
      const raw = await buildMime({
        from: { name: user.name, address: fromAddress },
        replyTo: channel.mode === 'relay' ? user.email : null,
        to,
        cc,
        subject,
        text: body,
        messageId,
        inReplyTo,
        references,
        files,
      });
      const delivered = await this.deliver(channel, raw, { from: fromAddress, to: [...to, ...cc] });
      provider = delivered.provider;
      if (delivered.messageId) messageId = delivered.messageId;
    }

    const row: Omit<MessageRow, 'activityId'> = {
      accountId: channel.mode === 'account' ? channel.account.id : null,
      userId,
      direction: 'outbound',
      status: channel.mode === 'log' ? 'logged' : 'sent',
      provider,
      messageId,
      threadKey: threadKey ?? messageId,
      inReplyTo,
      from: { address: fromAddress, name: user.name },
      to,
      cc,
      subject,
      text: body,
      sentAt,
    };
    try {
      const activity = await this.d.records.create(
        principal,
        'activity',
        { subject, type: 'Email', status: 'Completed', due_date: sentAt.slice(0, 10), related_to: target.id, description: truncate(body, DESCRIPTION_MAX) || null },
        {
          timestamp: sentAt,
          afterInsert: async (tx, rec) => {
            await this.insertMessage(tx, { ...row, activityId: rec.id });
            if (files.length) await this.d.attachments.store(tx, rec.id, files, 'email', userId);
          },
        },
      );
      return { activityId: activity.id, status: channel.mode === 'log' ? 'logged' : 'sent', via: channel.mode, from: fromAddress };
    } catch (err) {
      if (channel.mode === 'log') throw err;
      // The message left already: remember it so mailbox sync does not log it later as a new email.
      await this.insertMessage(this.d.db, { ...row, activityId: null }).catch(() => {});
      throw new AppError(500, 'email_not_logged', `The email was sent, but it could not be logged: ${errorMessage(err)}`);
    }
  }

  private async deliver(channel: Exclude<Channel, { mode: 'log' }>, raw: Buffer, envelope: { from: string; to: string[] }): Promise<{ provider: string; messageId?: string | null }> {
    if (channel.mode === 'relay') {
      const transport = this.d.transport(this.d.cfg.smtpUrl!);
      try {
        await transport.sendMail({ envelope, raw });
      } catch (err) {
        const e = mailServerError('SMTP', err, true);
        throw new AppError(502, 'mail_server_error', `The organization mail relay did not accept the message: ${e.message.replace(/^Could not connect to the SMTP server: /, '')}`);
      } finally {
        transport.close();
      }
      return { provider: 'relay' };
    }
    const account = channel.account;
    switch (account.provider) {
      case 'imap': {
        const creds = await this.d.accounts.credentials<PasswordCredentials>(account);
        const transport = await smtpTransport(this.d.transport, account.settings, creds, this.d.cfg.allowPrivateNetwork);
        try {
          await transport.sendMail({ envelope, raw });
        } catch (err) {
          throw mailServerError('SMTP', err, false);
        } finally {
          transport.close();
        }
        // SMTP does not keep a copy; put one in the Sent folder like a mail client would.
        this.d.jobs.enqueue(`imap-append:${account.id}`, async () => {
          try {
            const client = await openImap(this.d.imap, account.settings, creds, this.d.cfg.allowPrivateNetwork);
            try {
              await appendToSent(client, raw);
            } finally {
              await closeImap(client);
            }
          } catch {
            // Best effort: the email was sent and logged either way.
          }
        });
        return { provider: 'imap' };
      }
      case 'google': {
        const token = await this.d.accounts.accessToken(account);
        return { provider: 'google', messageId: await gmailSend(this.d.fetchImpl, token, raw) };
      }
      case 'microsoft': {
        if (raw.length > GRAPH_MAX_MIME_BYTES) throw badRequest('Emails sent through a Microsoft account can be at most about 3 MB including attachments');
        const token = await this.d.accounts.accessToken(account);
        await graphSend(this.d.fetchImpl, token, raw);
        return { provider: 'microsoft' };
      }
      default:
        throw badRequest(`${account.label} cannot send email`);
    }
  }

  private async insertMessage(db: Db, m: MessageRow): Promise<void> {
    await db.run(
      `INSERT INTO email_messages (id, activity_id, account_id, user_id, direction, status, provider, message_id, thread_key, in_reply_to, from_address, from_name,
         to_addresses, cc_addresses, subject, text_body, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('eml'),
        m.activityId,
        m.accountId,
        m.userId,
        m.direction,
        m.status,
        m.provider,
        m.messageId,
        m.threadKey,
        m.inReplyTo,
        m.from.address,
        m.from.name,
        JSON.stringify(m.to),
        JSON.stringify(m.cc),
        m.subject,
        truncate(m.text, MAX_BODY),
        m.sentAt,
        nowIso(),
      ],
    );
  }

  // ---------- IMAP accounts ----------

  private async testServers(settings: StoredSettings, creds: PasswordCredentials): Promise<void> {
    const allow = this.d.cfg.allowPrivateNetwork;
    const client = await openImap(this.d.imap, settings, creds, allow, true);
    await closeImap(client);
    if (settings.smtpHost) {
      const transport = await smtpTransport(this.d.transport, settings, creds, allow);
      try {
        await transport.verify();
      } catch (err) {
        throw mailServerError('SMTP', err, true);
      } finally {
        transport.close();
      }
    }
  }

  private imapSettings(input: ImapAccountRequest, address: string, base?: StoredSettings): StoredSettings {
    const host = (h: string | null | undefined) => h?.trim().toLowerCase() || undefined;
    const smtpHost = host(input.smtpHost);
    return {
      syncEmail: input.syncEmail ?? base?.syncEmail ?? true,
      syncCalendar: false,
      unmatched: input.unmatched ?? base?.unmatched ?? 'ignore',
      imapHost: host(input.imapHost),
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      smtpHost,
      smtpPort: smtpHost ? (input.smtpPort ?? 465) : undefined,
      smtpSecure: smtpHost ? (input.smtpSecure ?? true) : undefined,
      username: input.username?.trim() || address,
    };
  }

  /** Connects a mailbox by IMAP (and optionally SMTP) after checking that both servers accept the sign-in. */
  async connectImap(userId: string, input: ImapAccountRequest): Promise<Account> {
    const address = normalizeEmail(input.address);
    if (!address) throw badRequest('Enter a valid email address');
    await this.d.accounts.ready();
    if (await this.d.db.get("SELECT 1 FROM connected_accounts WHERE user_id = ? AND provider = 'imap' AND address = ?", [userId, address])) {
      throw conflict('This mailbox is already connected');
    }
    const settings = this.imapSettings(input, address);
    const creds: PasswordCredentials = { kind: 'password', password: input.password };
    await this.testServers(settings, creds);
    return this.d.accounts.insert({ userId, provider: 'imap', label: input.label?.trim() || address, address, settings, credentials: creds });
  }

  /** Changes server settings or the password of an IMAP mailbox (an empty password keeps the stored one). */
  async updateImap(userId: string, id: string, input: ImapAccountRequest): Promise<Account> {
    const account = await this.d.accounts.own(userId, id);
    if (account.provider !== 'imap') throw badRequest('Only IMAP mailboxes have server settings');
    const settings = { ...this.imapSettings(input, account.address!, account.settings), syncEmail: input.syncEmail ?? account.settings.syncEmail };
    const creds: PasswordCredentials = input.password ? { kind: 'password', password: input.password } : await this.d.accounts.credentials<PasswordCredentials>(account);
    await this.testServers(settings, creds);
    await this.d.accounts.saveCredentials(id, creds, settings);
    await this.d.accounts.markActive(id);
    return (await this.d.accounts.get(id))!;
  }

  // ---------- sync ----------

  private async known(messageId: string): Promise<boolean> {
    return !!(await this.d.db.get('SELECT 1 FROM email_messages WHERE message_id = ?', [messageId]));
  }

  /**
   * Whether a message in a Sent folder is the copy of one sent from the CRM: providers may give it a Message-ID of
   * their own, so it is recognised by sender, subject, recipients and time instead. The stored email then takes the
   * provider's Message-ID, which is the one replies refer to.
   */
  private async sentFromCrm(userId: string, from: string, subject: string, recipients: string[], sentAt: string, messageId: string | null): Promise<boolean> {
    const window = 15 * 60_000;
    const rows = await this.d.db.all<{ id: string; message_id: string; to_addresses: unknown; cc_addresses: unknown }>(
      `SELECT id, message_id, to_addresses, cc_addresses FROM email_messages
       WHERE user_id = ? AND direction = 'outbound' AND from_address = ? AND subject = ? AND sent_at >= ? AND sent_at <= ?`,
      [userId, from, subject, new Date(Date.parse(sentAt) - window).toISOString(), new Date(Date.parse(sentAt) + window).toISOString()],
    );
    const key = (list: string[]) => [...new Set(list.map((a) => a.toLowerCase()))].sort().join(',');
    const wanted = key(recipients);
    const match = rows.find((r) => key([...parseJson<string[]>(r.to_addresses, []), ...parseJson<string[]>(r.cc_addresses, [])]) === wanted);
    if (!match) return false;
    if (messageId && messageId !== match.message_id) {
      try {
        await this.d.db.run('UPDATE email_messages SET message_id = ? WHERE id = ?', [messageId, match.id]);
      } catch {
        // Another mailbox stored this Message-ID meanwhile.
      }
    }
    return true;
  }

  /** Keeps only the Message-ID of a deleted email activity, so the message is not logged again. */
  private async forget(activityId: string): Promise<void> {
    await this.d.db.run(
      `UPDATE email_messages SET activity_id = NULL, from_name = NULL, to_addresses = ?, cc_addresses = ?, subject = '', text_body = '' WHERE activity_id = ?`,
      ['[]', '[]', activityId],
    );
  }

  /** Clears emails whose activity was deleted while the server was not running its event handlers (e.g. a crash). */
  async forgetOrphans(): Promise<void> {
    await this.d.db.run(
      `UPDATE email_messages SET activity_id = NULL, from_name = NULL, to_addresses = ?, cc_addresses = ?, subject = '', text_body = ''
       WHERE activity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM records r WHERE r.id = email_messages.activity_id)`,
      ['[]', '[]'],
    );
  }

  private counterparts(ctx: MailContext, from: string, to: string[], cc: string[], outbound: boolean): string[] {
    const list = outbound ? [...to, ...cc] : [from, ...to, ...cc];
    return [...new Set(list.filter((a) => a && !ctx.internal.has(a) && !ctx.own.has(a)))];
  }

  /** The record an earlier message of the thread was logged on, if the user can read it. */
  private async threadTarget(principal: Principal, refs: string[]): Promise<CrmRecord | null> {
    for (const part of chunk(refs, 50)) {
      const rows = await this.d.db.all<{ activity_id: string }>(
        `SELECT activity_id FROM email_messages WHERE message_id IN (${placeholders(part.length)}) AND activity_id IS NOT NULL ORDER BY sent_at DESC`,
        part,
      );
      for (const r of rows) {
        const activity = await this.d.records.getRaw(r.activity_id);
        const related = activity?.fields.related_to;
        if (typeof related !== 'string') continue;
        try {
          return await this.d.records.get(principal, null, related);
        } catch {
          // not readable by this user
        }
      }
    }
    return null;
  }

  private async contactTarget(principal: Principal, addresses: string[]): Promise<CrmRecord | null> {
    const m = await readableMatch(this.d.db, this.d.records, principal, 'email', addresses);
    return m ? ((await this.d.records.getRaw(m.recordId)) ?? null) : null;
  }

  private async unmatchedTarget(ctx: MailContext, from: { address: string; name: string | null }, subject: string, text: string): Promise<CrmRecord | null> {
    const action = ctx.account.settings.unmatched;
    if (action === 'ignore') return null;
    try {
      if (action === 'lead') return await this.d.records.create(ctx.principal, 'lead', { ...nameParts(from.name, from.address), email: from.address });
      return await this.d.records.create(ctx.principal, 'case', {
        subject,
        origin: 'Email',
        supplied_name: from.name,
        supplied_email: from.address,
        description: truncate(text, DESCRIPTION_MAX) || null,
      });
    } catch (err) {
      // Duplicates, missing permissions and validation rules leave the email unlogged instead of failing the sync.
      if (err instanceof AppError && err.status < 500) return null;
      throw err;
    }
  }

  private sink(ctx: MailContext): MailSink {
    return {
      wants: async (env: Envelope, folder: MailFolder) => {
        if (env.messageId && (await this.known(env.messageId))) {
          ctx.stats.duplicates++;
          return false;
        }
        const from = env.from[0] ?? '';
        const outbound = folder === 'sent' || ctx.own.has(from);
        const others = this.counterparts(ctx, from, env.to, env.cc, outbound);
        if (!others.length) {
          ctx.stats.skipped++;
          return false;
        }
        if (env.inReplyTo && (await this.d.db.get('SELECT 1 FROM email_messages WHERE message_id = ? AND activity_id IS NOT NULL', [env.inReplyTo]))) return true;
        if ((await matchContacts(this.d.db, 'email', others)).size) return true;
        if (!outbound && ctx.account.settings.unmatched !== 'ignore') return true;
        ctx.stats.skipped++;
        return false;
      },
      ingest: async (raw: Buffer, folder: MailFolder) => {
        const outcome = await this.ingest(ctx, raw, folder);
        if (outcome === 'logged') ctx.stats.logged++;
        else if (outcome === 'duplicate') ctx.stats.duplicates++;
        else ctx.stats.skipped++;
        return outcome;
      },
    };
  }

  private async ingest(ctx: MailContext, raw: Buffer, folder: MailFolder): Promise<IngestOutcome> {
    let email: Email;
    try {
      email = await PostalMime.parse(raw);
    } catch {
      return 'skipped';
    }
    const messageId = normalizeMessageId(email.messageId) ?? `<${sha256(raw)}@titoforce.invalid>`;
    if (await this.known(messageId)) return 'duplicate';
    const from = flattenAddresses(email.from)[0];
    if (!from) return 'skipped';
    const to = flattenAddresses(email.to).map((a) => a.address);
    const cc = flattenAddresses(email.cc).map((a) => a.address);
    const outbound = folder === 'sent' || ctx.own.has(from.address);
    const subject = cleanSubject(email.subject) || '(no subject)';
    const sentAt = parseSentAt(email.date);
    if (outbound) {
      if (await this.sentFromCrm(ctx.account.userId, from.address, subject, [...to, ...cc], sentAt, normalizeMessageId(email.messageId))) return 'duplicate';
    } else if (isAutomated(email.headers, from.address)) {
      return 'skipped';
    }
    const others = this.counterparts(ctx, from.address, to, cc, outbound);
    if (!others.length) return 'skipped';
    const text = (email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : '').replace(/\r\n?/g, '\n').trim();
    const refs = parseReferences(email.references, email.inReplyTo);

    const target =
      (await this.threadTarget(ctx.principal, refs)) ??
      (await this.contactTarget(ctx.principal, others)) ??
      (outbound ? null : await this.unmatchedTarget(ctx, from, subject, text));
    if (!target) return 'skipped';

    const files: FileContent[] = [];
    for (const a of email.attachments) {
      if (a.related || files.length >= MAX_FILES) continue;
      const c = a.content;
      const data = typeof c === 'string' ? Buffer.from(c) : c instanceof ArrayBuffer ? Buffer.from(c) : Buffer.from(c.buffer, c.byteOffset, c.byteLength);
      if (!data.length || data.length > this.d.cfg.attachmentMaxBytes) continue;
      files.push({ fileName: a.filename || 'attachment', contentType: a.mimeType, data });
    }
    const row: Omit<MessageRow, 'activityId'> = {
      accountId: ctx.account.id,
      userId: ctx.account.userId,
      direction: outbound ? 'outbound' : 'inbound',
      status: outbound ? 'sent' : 'received',
      provider: ctx.account.provider,
      messageId,
      threadKey: refs[0] ?? messageId,
      inReplyTo: normalizeMessageId(email.inReplyTo),
      from,
      to,
      cc,
      subject,
      text,
      sentAt,
    };
    try {
      await this.d.records.create(
        ctx.principal,
        'activity',
        { subject, type: 'Email', status: 'Completed', due_date: sentAt.slice(0, 10), related_to: target.id, description: truncate(text, DESCRIPTION_MAX) || null },
        {
          timestamp: sentAt,
          afterInsert: async (tx, rec) => {
            await this.insertMessage(tx, { ...row, activityId: rec.id });
            if (files.length) await this.d.attachments.store(tx, rec.id, files, 'email', ctx.account.userId);
          },
        },
      );
    } catch (err) {
      // Another mailbox logged the same message concurrently (unique Message-ID).
      if (await this.known(messageId)) return 'duplicate';
      throw err;
    }
    return 'logged';
  }

  /** Reads new mail of one account and logs it. Returns what happened to the messages read. */
  async syncMail(account: Account): Promise<MailSyncStats> {
    const stats: MailSyncStats = { logged: 0, duplicates: 0, skipped: 0 };
    if (!this.d.accounts.capabilities(account).syncEmail || !account.settings.syncEmail) return stats;
    const principal = await this.d.users.principalForUser(account.userId);
    if (!objectPermission(principal, 'activity').create) throw forbidden('Your role cannot create activities, so synced email cannot be logged');
    const user = await this.d.users.getUser(account.userId);
    const own = new Set([account.address, user?.email].filter((a): a is string => !!a).map((a) => a.toLowerCase()));
    const ctx: MailContext = { account, principal, own, internal: await internalAddresses(this.d.db), stats };
    const sink = this.sink(ctx);
    const startedAt = nowIso();
    let state: SyncState;
    switch (account.provider) {
      case 'imap': {
        const creds = await this.d.accounts.credentials<PasswordCredentials>(account);
        const client = await openImap(this.d.imap, account.settings, creds, this.d.cfg.allowPrivateNetwork);
        try {
          state = await syncImap(client, account.syncState, sink, SYNC_BUDGET);
        } finally {
          await closeImap(client);
        }
        break;
      }
      case 'google':
        state = await syncGmail(this.d.fetchImpl, await this.d.accounts.accessToken(account), account.syncState, sink, SYNC_BUDGET);
        break;
      case 'microsoft':
        state = await syncGraphMail(this.d.fetchImpl, await this.d.accounts.accessToken(account), account.syncState, sink, SYNC_BUDGET);
        break;
      default:
        return stats;
    }
    // The cursor may have moved on while syncing; read the latest state of other parts before writing.
    const latest = (await this.d.accounts.get(account.id))?.syncState ?? {};
    await this.d.accounts.setSyncState(account.id, { ...latest, ...state, mailSyncedAt: startedAt });
    return stats;
  }
}

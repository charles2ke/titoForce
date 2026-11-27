import { randomBytes } from 'node:crypto';
import type { CalendarSyncStats, CrmRecord, MeetingRequest, MeetingResult, RecordData } from '@titoforce/shared';
import type { IntegrationsConfig } from '../config.ts';
import { type Db, parseJson } from '../db/database.ts';
import { normalizeEmail, readableMatch } from '../platform/contact-points.ts';
import type { EventBus, JobQueue, RecordChangeEvent } from '../platform/events.ts';
import type { NotificationService } from '../platform/notifications.ts';
import { assertCanCreate, objectPermission, type Principal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import type { UserService } from '../platform/users.ts';
import { addDays, AppError, badRequest, chunk, conflict, forbidden, isoDate, newId, nowIso, placeholders, truncate } from '../util.ts';
import { type Account, type AccountService, type FeedCredentials, internalAddresses } from './accounts.ts';
import { sha256 } from './crypto.ts';
import { googleCreateEvent, googleDeleteEvent, googleEvents, googleUpdateEvent } from './google.ts';
import { buildIcsFeed, type FeedEvent, parseIcs } from './ics.ts';
import { graphCreateEvent, graphDeleteEvent, graphEvents, graphUpdateEvent } from './microsoft.ts';
import { htmlToText } from './mime.ts';
import { fetchPublicText, parseFeedUrl } from './net.ts';
import { errorMessage } from './oauth.ts';
import type { CalendarEvent, EventInput } from './types.ts';

/** Calendar sync reads events from this many days ago up to FUTURE_DAYS ahead. */
export const PAST_DAYS = 30;
export const FUTURE_DAYS = 90;
const FEED_PAST_DAYS = 90;
const FEED_FUTURE_DAYS = 365;
const FEED_MAX = 2000;
const MAX_ATTENDEES = 50;
const DESCRIPTION_MAX = 32_000;
const MAX_MEETING_MS = 14 * 86_400_000;
/** Activity fields copied to the calendar event of a meeting created in the CRM. */
const PUSHED_FIELDS = new Set(['subject', 'start_time', 'end_time', 'location', 'attendees', 'description']);

interface EventRow {
  id: string;
  account_id: string | null;
  user_id: string;
  external_id: string;
  activity_id: string | null;
  direction: 'import' | 'export';
  fingerprint: string | null;
  options: unknown;
}

interface RowOptions {
  /** The provider's own event id. */
  providerId?: string | null;
  sendInvites?: boolean;
}

interface NewRow {
  accountId: string;
  userId: string;
  externalId: string;
  activityId: string;
  direction: 'import' | 'export';
  fingerprint: string | null;
  options: RowOptions;
}

interface SyncContext {
  account: Account;
  principal: Principal;
  own: Set<string>;
  internal: Set<string>;
}

export interface CalendarDeps {
  db: Db;
  cfg: IntegrationsConfig;
  records: RecordService;
  users: UserService;
  accounts: AccountService;
  notifications: NotificationService;
  jobs: JobQueue;
  events: EventBus;
  fetchImpl: typeof fetch;
}

const ROW_COLUMNS = 'id, account_id, user_id, external_id, activity_id, direction, fingerprint, options';

const fingerprint = (e: CalendarEvent): string =>
  sha256(JSON.stringify([e.title, e.start, e.end, e.allDay, e.location, e.description, e.organizer, e.attendees.map((a) => a.email).sort(), e.cancelled]));

function cleanDescription(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const text = /<\/?[a-z][^>]*>/i.test(value) ? htmlToText(value) : value;
  return truncate(text.replace(/\r\n?/g, '\n').trim(), DESCRIPTION_MAX) || null;
}

/** Email addresses in a free-text list (the activity's Attendees field). */
export function attendeeList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const out = new Set<string>();
  for (const part of value.split(/[\s,;]+/)) {
    const email = normalizeEmail(part.replace(/^mailto:/i, '').replace(/^<|>$/g, ''));
    if (email) out.add(email);
  }
  return [...out];
}

function parseTime(value: string, label: string): string {
  const ms = Date.parse(value);
  if (!value || Number.isNaN(ms)) throw badRequest(`${label} is not a valid date and time`);
  return new Date(ms).toISOString();
}

/** Logs meetings from connected calendars, adds meetings created in the CRM to calendars, and publishes a calendar feed. */
export class CalendarService {
  private d: CalendarDeps;
  /** Calendar events with an update in progress: true when another update was requested meanwhile. */
  private pushing = new Map<string, boolean>();

  constructor(deps: CalendarDeps) {
    this.d = deps;
    deps.events.on((e) => this.onActivityChange(e));
  }

  // ---------- subscribed calendars (iCalendar URLs) ----------

  /** Subscribes to a calendar by its iCalendar address after checking that it returns a calendar. */
  async connectIcs(userId: string, input: { url: string; label?: string | null }): Promise<Account> {
    const url = parseFeedUrl(input.url);
    await this.d.accounts.ready();
    const feedHash = sha256(url.toString());
    if ((await this.d.accounts.list(userId)).some((a) => a.provider === 'ics' && a.settings.feedHash === feedHash)) throw conflict('This calendar is already connected');
    const text = await fetchPublicText(url, { allowPrivate: this.d.cfg.allowPrivateNetwork });
    const now = new Date();
    parseIcs(text, { from: now, to: now, self: [] });
    return this.d.accounts.insert({
      userId,
      provider: 'ics',
      label: input.label?.trim() || url.hostname,
      address: null,
      settings: { syncEmail: false, syncCalendar: true, unmatched: 'ignore', feedHost: url.hostname, feedHash },
      credentials: { kind: 'feed', url: url.toString() } satisfies FeedCredentials,
    });
  }

  // ---------- import ----------

  private async providerEvents(account: Account, from: Date, to: Date, self: string[]): Promise<CalendarEvent[]> {
    switch (account.provider) {
      case 'google':
        return googleEvents(this.d.fetchImpl, await this.d.accounts.accessToken(account), from, to);
      case 'microsoft':
        return graphEvents(this.d.fetchImpl, await this.d.accounts.accessToken(account), from, to);
      case 'ics': {
        const creds = await this.d.accounts.credentials<FeedCredentials>(account);
        const text = await fetchPublicText(parseFeedUrl(creds.url), { allowPrivate: this.d.cfg.allowPrivateNetwork });
        return parseIcs(text, { from, to, self });
      }
      default:
        return [];
    }
  }

  /**
   * Logs the account's meetings with customers as activities and applies later changes to them. Events already logged
   * from another calendar, or whose activity was deleted, are not logged again.
   */
  async syncCalendar(account: Account): Promise<CalendarSyncStats> {
    const stats: CalendarSyncStats = { imported: 0, updated: 0, skipped: 0 };
    if (!this.d.accounts.capabilities(account).calendar || !account.settings.syncCalendar) return stats;
    const principal = await this.d.users.principalForUser(account.userId);
    if (!objectPermission(principal, 'activity').create) throw forbidden('Your role cannot create activities, so meetings cannot be logged');
    const user = await this.d.users.getUser(account.userId);
    const own = new Set([account.address, user?.email].filter((a): a is string => !!a).map((a) => a.toLowerCase()));
    const now = new Date();
    const events = await this.providerEvents(account, addDays(now, -PAST_DAYS), addDays(now, FUTURE_DAYS), [...own]);
    const unique = new Map<string, CalendarEvent>();
    for (const e of events) if (!unique.has(e.key)) unique.set(e.key, e);
    const rows = await this.rowsFor([...unique.keys()]);
    const ctx: SyncContext = { account, principal, own, internal: await internalAddresses(this.d.db) };
    for (const e of unique.values()) {
      try {
        stats[await this.importEvent(ctx, e, rows.get(e.key) ?? [])]++;
      } catch (err) {
        // Validation rules, duplicate rules and permissions skip one event instead of failing the sync.
        if (err instanceof AppError && err.status < 500) stats.skipped++;
        else throw err;
      }
    }
    return stats;
  }

  private async rowsFor(keys: string[]): Promise<Map<string, EventRow[]>> {
    const out = new Map<string, EventRow[]>();
    for (const part of chunk(keys, 200)) {
      const rows = await this.d.db.all<EventRow>(`SELECT ${ROW_COLUMNS} FROM calendar_events WHERE external_id IN (${placeholders(part.length)})`, part);
      for (const r of rows) out.set(r.external_id, [...(out.get(r.external_id) ?? []), r]);
    }
    return out;
  }

  private participants(e: CalendarEvent): string[] {
    return [...new Set([e.organizer, ...e.attendees.map((a) => a.email)].filter((a): a is string => !!a))];
  }

  /** Activity fields of an imported event. All-day events only have a date. */
  private fieldsFor(e: CalendarEvent, own: Set<string>): RecordData {
    const cancelled = e.cancelled && !/^cancell?ed:/i.test(e.title);
    return {
      subject: truncate(cancelled ? `Canceled: ${e.title}` : e.title, 255),
      due_date: e.start.slice(0, 10),
      start_time: e.allDay ? null : e.start,
      end_time: e.allDay || !e.end ? null : e.end,
      location: e.location ? truncate(e.location, 255) : null,
      attendees:
        this.participants(e)
          .filter((a) => !own.has(a))
          .slice(0, 100)
          .join('\n') || null,
      description: cleanDescription(e.description),
    };
  }

  private async importEvent(ctx: SyncContext, e: CalendarEvent, rows: EventRow[]): Promise<keyof CalendarSyncStats> {
    const fp = fingerprint(e);
    let mine = rows.find((r) => r.account_id === ctx.account.id);
    if (!mine) {
      // Rows of an earlier connection of this user's calendar carry on with the new connection.
      const orphan = rows.find((r) => r.account_id === null && r.user_id === ctx.account.userId);
      if (orphan) {
        const { changes } = await this.d.db.run('UPDATE calendar_events SET account_id = ? WHERE id = ? AND account_id IS NULL', [ctx.account.id, orphan.id]);
        if (changes) mine = { ...orphan, account_id: ctx.account.id };
      }
    }
    if (mine) {
      // Meetings created in the CRM are kept as they are there; deleted activities are not brought back.
      if (mine.direction === 'export' || !mine.activity_id || mine.fingerprint === fp) return 'skipped';
      const activity = await this.d.records.getRaw(mine.activity_id);
      if (!activity) {
        await this.d.db.run('UPDATE calendar_events SET activity_id = NULL, updated_at = ? WHERE id = ?', [nowIso(), mine.id]);
        return 'skipped';
      }
      const fields = this.fieldsFor(e, ctx.own);
      // A cancelled meeting keeps its details; only the subject tells it was cancelled.
      await this.d.records.update(ctx.principal, 'activity', activity.id, e.cancelled ? { subject: fields.subject } : fields);
      await this.d.db.run('UPDATE calendar_events SET fingerprint = ?, updated_at = ? WHERE id = ?', [fp, nowIso(), mine.id]);
      return 'updated';
    }
    // Logged from another calendar already (e.g. a colleague's invitation to the same meeting).
    if (rows.length) return 'skipped';
    if (e.cancelled || e.declined) return 'skipped';
    const customers = this.participants(e).filter((a) => !ctx.own.has(a) && !ctx.internal.has(a));
    if (!customers.length) return 'skipped';
    const match = await readableMatch(this.d.db, this.d.records, ctx.principal, 'email', customers);
    if (!match) return 'skipped';

    const startMs = Date.parse(e.allDay ? `${e.start.slice(0, 10)}T00:00:00Z` : e.start);
    const endMs = e.end ? Date.parse(e.allDay ? `${e.end.slice(0, 10)}T00:00:00Z` : e.end) : startMs;
    try {
      await this.d.records.create(
        ctx.principal,
        'activity',
        { ...this.fieldsFor(e, ctx.own), type: 'Meeting', status: endMs < Date.now() ? 'Completed' : 'Open', related_to: match.recordId },
        {
          // Past meetings take their place on the timeline; upcoming ones appear when they were logged.
          timestamp: startMs < Date.now() ? new Date(startMs).toISOString() : undefined,
          afterInsert: (tx, rec) =>
            this.insertRow(tx, {
              accountId: ctx.account.id,
              userId: ctx.account.userId,
              externalId: e.key,
              activityId: rec.id,
              direction: 'import',
              fingerprint: fp,
              options: { providerId: e.providerId },
            }),
        },
      );
    } catch (err) {
      // The same calendar was synced concurrently.
      if (await this.d.db.get('SELECT 1 FROM calendar_events WHERE account_id = ? AND external_id = ?', [ctx.account.id, e.key])) return 'skipped';
      throw err;
    }
    return 'imported';
  }

  private async insertRow(db: Db, r: NewRow): Promise<void> {
    await db.run(
      `INSERT INTO calendar_events (id, account_id, user_id, external_id, activity_id, direction, fingerprint, options, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('cev'), r.accountId, r.userId, r.externalId, r.activityId, r.direction, r.fingerprint, JSON.stringify(r.options), nowIso()],
    );
  }

  // ---------- meetings created in the CRM ----------

  private async providerCreate(account: Account, ev: EventInput): Promise<{ providerId: string; key: string }> {
    const token = await this.d.accounts.accessToken(account);
    if (account.provider === 'google') return googleCreateEvent(this.d.fetchImpl, token, ev);
    if (account.provider === 'microsoft') return graphCreateEvent(this.d.fetchImpl, token, ev);
    throw badRequest(`${account.label} cannot add events to a calendar`);
  }

  private async providerUpdate(account: Account, providerId: string, ev: EventInput): Promise<void> {
    const token = await this.d.accounts.accessToken(account);
    if (account.provider === 'google') await googleUpdateEvent(this.d.fetchImpl, token, providerId, ev);
    else if (account.provider === 'microsoft') await graphUpdateEvent(this.d.fetchImpl, token, providerId, ev);
  }

  private async providerDelete(account: Account, providerId: string, sendInvites: boolean): Promise<void> {
    const token = await this.d.accounts.accessToken(account);
    if (account.provider === 'google') await googleDeleteEvent(this.d.fetchImpl, token, providerId, sendInvites);
    else if (account.provider === 'microsoft') await graphDeleteEvent(this.d.fetchImpl, token, providerId);
  }

  /**
   * Logs a meeting on a record and, with a calendar account, adds it to that calendar (optionally inviting the
   * attendees). When the calendar refuses the event, the meeting stays logged and the error is returned.
   */
  async createMeeting(principal: Principal, input: MeetingRequest): Promise<MeetingResult> {
    if (principal.type !== 'user' || !principal.userId) throw forbidden('Only users can schedule meetings');
    const userId = principal.userId;
    const target = await this.d.records.get(principal, null, input.recordId);
    assertCanCreate(principal, 'activity');
    const subject = (input.subject ?? '').replace(/\s+/g, ' ').trim();
    if (!subject) throw badRequest('Subject is required');
    if (subject.length > 255) throw badRequest('Subject must be at most 255 characters');
    const start = parseTime(input.start, 'Start');
    const end = parseTime(input.end, 'End');
    if (Date.parse(end) <= Date.parse(start)) throw badRequest('The meeting must end after it starts');
    if (Date.parse(end) - Date.parse(start) > MAX_MEETING_MS) throw badRequest('A meeting can last at most 14 days');
    const attendees = [
      ...new Set(
        (input.attendees ?? [])
          .map((a) => a.trim())
          .filter(Boolean)
          .map((a) => {
            const n = normalizeEmail(a);
            if (!n) throw badRequest(`Attendees: "${truncate(a, 80)}" is not a valid email address`);
            return n;
          }),
      ),
    ];
    if (attendees.length > MAX_ATTENDEES) throw badRequest(`A meeting can have at most ${MAX_ATTENDEES} attendees`);
    const location = input.location?.trim() || null;
    if (location && location.length > 255) throw badRequest('Location must be at most 255 characters');
    const description = input.description?.replace(/\r\n?/g, '\n').trim() || null;
    if (description && description.length > DESCRIPTION_MAX) throw badRequest(`The description can be at most ${DESCRIPTION_MAX.toLocaleString('en-US')} characters`);

    let account: Account | null = null;
    if (input.accountId) {
      account = await this.d.accounts.own(userId, input.accountId);
      if (!this.d.accounts.capabilities(account).exportEvents) throw badRequest(`${account.label} cannot add events to a calendar`);
      // A sign-in that has to be renewed fails here, before anything is saved.
      await this.d.accounts.accessToken(account);
    } else if (input.sendInvites) {
      throw badRequest('Choose a calendar to send the invitations from');
    }
    const sendInvites = !!input.sendInvites && attendees.length > 0;

    const activity = await this.d.records.create(principal, 'activity', {
      subject,
      type: 'Meeting',
      status: Date.parse(end) < Date.now() ? 'Completed' : 'Open',
      due_date: start.slice(0, 10),
      start_time: start,
      end_time: end,
      location,
      attendees: attendees.join('\n') || null,
      description,
      related_to: target.id,
    });
    if (!account) return { activityId: activity.id, calendar: null, calendarError: null };
    try {
      const created = await this.providerCreate(account, { title: subject, start, end, location, description, attendees, sendInvites });
      await this.insertRow(this.d.db, {
        accountId: account.id,
        userId,
        externalId: created.key,
        activityId: activity.id,
        direction: 'export',
        fingerprint: null,
        options: { providerId: created.providerId, sendInvites },
      });
      return { activityId: activity.id, calendar: { accountId: account.id, provider: account.provider }, calendarError: null };
    } catch (err) {
      return { activityId: activity.id, calendar: null, calendarError: `The meeting was logged, but ${account.label} did not accept it: ${errorMessage(err)}` };
    }
  }

  /** Keeps calendar events of meetings created in the CRM in step with their activities. */
  private async onActivityChange(e: RecordChangeEvent): Promise<void> {
    if (e.object !== 'activity') return;
    if (e.type === 'deleted') {
      const rows = await this.d.db.all<EventRow>(`SELECT ${ROW_COLUMNS} FROM calendar_events WHERE activity_id = ?`, [e.record.id]);
      if (!rows.length) return;
      // Kept as tombstones, so the event is not imported again.
      await this.d.db.run('UPDATE calendar_events SET activity_id = NULL, updated_at = ? WHERE activity_id = ?', [nowIso(), e.record.id]);
      for (const r of rows) {
        const opts = parseJson<RowOptions>(r.options, {});
        if (r.direction !== 'export' || !r.account_id || !opts.providerId) continue;
        const accountId = r.account_id;
        const providerId = opts.providerId;
        this.d.jobs.enqueue(`calendar-delete:${r.id}`, async () => {
          const account = await this.d.accounts.get(accountId);
          if (!account) return;
          try {
            await this.providerDelete(account, providerId, !!opts.sendInvites);
          } catch (err) {
            await this.d.notifications.notify(
              [account.userId],
              'Calendar event not removed',
              `"${e.record.name}" was deleted, but it could not be removed from ${account.label}: ${errorMessage(err)}`,
            );
          }
        });
      }
      return;
    }
    if (e.type !== 'updated' || !e.changed.some((f) => PUSHED_FIELDS.has(f))) return;
    const row = await this.d.db.get<{ id: string }>("SELECT id FROM calendar_events WHERE activity_id = ? AND direction = 'export' AND account_id IS NOT NULL", [e.record.id]);
    if (row) this.schedulePush(row.id);
  }

  /** Runs one update at a time per event, always with the activity's latest state. */
  private schedulePush(rowId: string): void {
    if (this.pushing.has(rowId)) {
      this.pushing.set(rowId, true);
      return;
    }
    this.pushing.set(rowId, false);
    this.d.jobs.enqueue(`calendar-update:${rowId}`, async () => {
      try {
        do {
          this.pushing.set(rowId, false);
          await this.push(rowId);
        } while (this.pushing.get(rowId));
      } finally {
        this.pushing.delete(rowId);
      }
    });
  }

  private async push(rowId: string): Promise<void> {
    const row = await this.d.db.get<EventRow>(`SELECT ${ROW_COLUMNS} FROM calendar_events WHERE id = ?`, [rowId]);
    if (!row?.account_id || !row.activity_id) return;
    const opts = parseJson<RowOptions>(row.options, {});
    const account = await this.d.accounts.get(row.account_id);
    const activity = await this.d.records.getRaw(row.activity_id);
    if (!account || !activity || !opts.providerId) return;
    const f = activity.fields;
    const start = typeof f.start_time === 'string' ? f.start_time : null;
    const end = typeof f.end_time === 'string' ? f.end_time : null;
    const fail = (reason: string) =>
      this.d.notifications.notify([account.userId], 'Calendar event not updated', `Changes to "${activity.name}" were not saved to ${account.label}: ${reason}`, `/r/${activity.id}`);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      await fail('a meeting in a calendar needs a start and an end time.');
      return;
    }
    try {
      await this.providerUpdate(account, opts.providerId, {
        title: activity.name,
        start,
        end,
        location: typeof f.location === 'string' ? f.location : null,
        description: typeof f.description === 'string' ? f.description : null,
        attendees: attendeeList(f.attendees).slice(0, MAX_ATTENDEES),
        sendInvites: !!opts.sendInvites,
      });
    } catch (err) {
      await fail(errorMessage(err));
    }
  }

  // ---------- feed ----------

  async feedEnabled(userId: string): Promise<boolean> {
    return !!(await this.d.db.get('SELECT 1 FROM calendar_feeds WHERE user_id = ?', [userId]));
  }

  /** Creates the user's calendar feed link, replacing an earlier one. */
  async createFeed(userId: string): Promise<{ url: string }> {
    const token = randomBytes(24).toString('base64url');
    await this.d.db.transaction(async (tx) => {
      await tx.run('DELETE FROM calendar_feeds WHERE user_id = ?', [userId]);
      await tx.run('INSERT INTO calendar_feeds (user_id, token_hash, created_at) VALUES (?, ?, ?)', [userId, sha256(token), nowIso()]);
    });
    return { url: `${this.d.cfg.publicUrl}/api/calendar/feed/${token}.ics` };
  }

  async deleteFeed(userId: string): Promise<void> {
    await this.d.db.run('DELETE FROM calendar_feeds WHERE user_id = ?', [userId]);
  }

  /**
   * The calendar feed of the link's owner: their calls, meetings and tasks that are not in a connected calendar
   * already. Undefined when the link is unknown or its owner is deactivated.
   */
  async feed(token: string): Promise<string | undefined> {
    if (!/^[\w-]{20,100}$/.test(token)) return undefined;
    const row = await this.d.db.get<{ user_id: string }>('SELECT user_id FROM calendar_feeds WHERE token_hash = ?', [sha256(token)]);
    if (!row) return undefined;
    const user = await this.d.users.getUser(row.user_id);
    if (!user?.active) return undefined;
    const principal = await this.d.users.principalForUser(row.user_id);
    const name = `titoForce: ${user.name}`;
    if (objectPermission(principal, 'activity').read === 'none') return buildIcsFeed(name, []);

    const now = new Date();
    const from = isoDate(addDays(now, -FEED_PAST_DAYS));
    const to = isoDate(addDays(now, FEED_FUTURE_DAYS));
    const activities: CrmRecord[] = [];
    const refs: Record<string, { name: string }> = {};
    for (let page = 1; activities.length < FEED_MAX; page++) {
      const res = await this.d.records.query(principal, 'activity', {
        filters: {
          match: 'all',
          rules: [
            { field: 'owner_id', op: 'eq', value: row.user_id },
            { field: 'type', op: 'in', value: ['Call', 'Meeting', 'Task'] },
          ],
        },
        andFilters: [
          {
            match: 'any',
            rules: [
              { field: 'due_date', op: 'gte', value: from },
              { field: 'start_time', op: 'gte', value: from },
            ],
          },
          {
            match: 'any',
            rules: [
              { field: 'due_date', op: 'lte', value: to },
              { field: 'start_time', op: 'lte', value: to },
            ],
          },
        ],
        sort: { field: 'created_at', dir: 'desc' },
        page,
        pageSize: 500,
      });
      activities.push(...res.records);
      Object.assign(refs, res.refs);
      if (res.records.length < 500) break;
    }

    const inCalendar = new Set<string>();
    for (const part of chunk(
      activities.map((a) => a.id),
      200,
    )) {
      const rows = await this.d.db.all<{ activity_id: string }>(
        `SELECT activity_id FROM calendar_events WHERE account_id IS NOT NULL AND activity_id IN (${placeholders(part.length)})`,
        part,
      );
      for (const r of rows) inCalendar.add(r.activity_id);
    }

    const events: FeedEvent[] = [];
    for (const a of activities) {
      if (inCalendar.has(a.id)) continue;
      const f = a.fields;
      const start = typeof f.start_time === 'string' ? f.start_time : null;
      const end = typeof f.end_time === 'string' ? f.end_time : null;
      const due = typeof f.due_date === 'string' ? f.due_date : null;
      if (!start && !due) continue;
      const related = typeof f.related_to === 'string' ? refs[f.related_to]?.name : undefined;
      const description = [related ? `Related to: ${related}` : null, typeof f.description === 'string' ? f.description : null].filter(Boolean).join('\n\n');
      events.push({
        uid: `${a.id}@titoforce`,
        title: a.name,
        start: start ?? due!,
        end: start && end && Date.parse(end) > Date.parse(start) ? end : null,
        allDay: !start,
        location: typeof f.location === 'string' ? f.location : null,
        description: description || null,
        url: `${this.d.cfg.publicUrl}/r/${a.id}`,
        updatedAt: a.updatedAt,
        completed: f.status === 'Completed',
      });
    }
    return buildIcsFeed(name, events, now);
  }
}

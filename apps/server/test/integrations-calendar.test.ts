import type { TimelineItem } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { parseIcs } from '../src/integrations/ics.ts';
import type { Services } from '../src/services.ts';
import { createTestServices, demoUser, principal } from './helpers.ts';
import { type ApiClient, INTEGRATION_ENV, signIn, startWebServer } from './integration-fakes.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let s: Services;
let app: FastifyInstance;
let web: Awaited<ReturnType<typeof startWebServer>>;
let james: ApiClient;
let priya: ApiClient;
let ann: string;
let calendarId: string;

beforeAll(async () => {
  web = await startWebServer();
  s = await createTestServices({ env: INTEGRATION_ENV });
  app = await buildApp(s);
  james = await signIn(app, 'james');
  priya = await signIn(app, 'priya');
  ann = (await s.records.create(await principal(s, 'james'), 'contact', { first_name: 'Ann', last_name: 'Customer', email: 'ann@customer.example' })).id;
});
afterAll(async () => {
  await app?.close();
  await s?.close();
  await web?.close();
});

/** A whole hour, `offset` from now. */
function at(offset: number): Date {
  const d = new Date(Date.now() + offset);
  d.setUTCMinutes(0, 0, 0);
  return d;
}
const later = (d: Date, ms: number) => new Date(d.getTime() + ms);
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Wall-clock time in a zone `minutes` ahead of UTC (for TZID= values). */
const wall = (d: Date, minutes: number) => utc(later(d, minutes * 60_000)).replace('Z', '');
const date = (d: Date) => d.toISOString().slice(0, 10);

function ics(...events: string[][]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Calendar//EN', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR', ''].join('\r\n');
}

const errorOf = (res: { statusCode: number; json(): { error?: { message?: string } } }) => [res.statusCode, res.json().error?.message];

async function sync(client: ApiClient, id: string) {
  await s.jobs.drain();
  const res = await client('POST', `/api/integrations/accounts/${id}/sync`);
  expect(res.statusCode).toBe(200);
  return res.json().result;
}

async function meetings(): Promise<TimelineItem[]> {
  const res = await james('GET', `/api/records/contact/${ann}/timeline`);
  expect(res.statusCode).toBe(200);
  return (res.json().items as TimelineItem[]).filter((i) => i.activityType === 'Meeting');
}
const titles = (items: TimelineItem[]) => items.map((i) => i.title).sort();

describe('subscribed calendars', () => {
  const PATH = '/work.ics?token=s3cret-calendar-token';
  const reviewStart = at(-3 * DAY);
  const weeklyStart = at(-10 * DAY - 2 * HOUR);
  const offsite = at(5 * DAY);
  const cal = { reviewSummary: 'Quarterly review', reviewLocation: 'Room 4\\, HQ', offsiteStatus: 'CONFIRMED', intro: false };

  const publish = () =>
    web.set(
      PATH,
      ics(
        [
          'UID:review@example.com',
          `DTSTAMP:${utc(new Date())}`,
          // No VTIMEZONE in the file: the IANA name is resolved by the server (India is 5:30 ahead of UTC, without DST).
          `DTSTART;TZID=Asia/Kolkata:${wall(reviewStart, 330)}`,
          `DTEND;TZID=Asia/Kolkata:${wall(later(reviewStart, HOUR), 330)}`,
          `SUMMARY:${cal.reviewSummary}`,
          `LOCATION:${cal.reviewLocation}`,
          'DESCRIPTION:Agenda:\\n- pricing\\n- next steps',
          'ORGANIZER;CN=James Chen:mailto:james@titoforce.example',
          'ATTENDEE;CN=Ann Customer;PARTSTAT=ACCEPTED:mailto:Ann@Customer.example',
          'ATTENDEE;CUTYPE=ROOM;CN=Room 4:mailto:room-4@resource.example',
          'ATTENDEE;CN=Bob Partner:mailto:bob@partner.example',
        ],
        ['UID:internal@example.com', `DTSTART:${utc(at(-DAY))}`, `DTEND:${utc(later(at(-DAY), HOUR))}`, 'SUMMARY:Team sync', 'ORGANIZER:mailto:james@titoforce.example', 'ATTENDEE:mailto:maria@titoforce.example'],
        [
          'UID:declined@example.com',
          `DTSTART:${utc(at(2 * DAY))}`,
          `DTEND:${utc(later(at(2 * DAY), HOUR))}`,
          'SUMMARY:Declined demo',
          'ORGANIZER:mailto:ann@customer.example',
          'ATTENDEE;PARTSTAT=DECLINED:mailto:james@titoforce.example',
        ],
        [
          'UID:weekly@example.com',
          `DTSTART:${utc(weeklyStart)}`,
          `DTEND:${utc(later(weeklyStart, HOUR / 2))}`,
          'RRULE:FREQ=WEEKLY;COUNT=4',
          `EXDATE:${utc(later(weeklyStart, 14 * DAY))}`,
          'SUMMARY:Weekly check-in',
          'ORGANIZER:mailto:ann@customer.example',
          'ATTENDEE;PARTSTAT=ACCEPTED:mailto:james@titoforce.example',
        ],
        [
          'UID:weekly@example.com',
          `RECURRENCE-ID:${utc(later(weeklyStart, 21 * DAY))}`,
          `DTSTART:${utc(later(weeklyStart, 21 * DAY + HOUR))}`,
          `DTEND:${utc(later(weeklyStart, 21 * DAY + 1.5 * HOUR))}`,
          'SUMMARY:Weekly check-in (moved)',
          'ORGANIZER:mailto:ann@customer.example',
          'ATTENDEE;PARTSTAT=ACCEPTED:mailto:james@titoforce.example',
        ],
        [
          'UID:offsite@example.com',
          `DTSTART;VALUE=DATE:${date(offsite).replace(/-/g, '')}`,
          `DTEND;VALUE=DATE:${date(later(offsite, DAY)).replace(/-/g, '')}`,
          'SUMMARY:Offsite',
          `STATUS:${cal.offsiteStatus}`,
          'ATTENDEE:mailto:ann@customer.example',
        ],
        ['UID:cancelled@example.com', `DTSTART:${utc(at(3 * DAY))}`, `DTEND:${utc(later(at(3 * DAY), HOUR))}`, 'SUMMARY:Cancelled demo', 'STATUS:CANCELLED', 'ATTENDEE:mailto:ann@customer.example'],
        ['UID:stranger@example.com', `DTSTART:${utc(at(4 * DAY))}`, `DTEND:${utc(later(at(4 * DAY), HOUR))}`, 'SUMMARY:Coffee', 'ATTENDEE:mailto:someone@elsewhere.example'],
        ['UID:old@example.com', `DTSTART:${utc(at(-60 * DAY))}`, `DTEND:${utc(later(at(-60 * DAY), HOUR))}`, 'SUMMARY:Long ago', 'ATTENDEE:mailto:ann@customer.example'],
        // ical.js rejects the whole file because of this event; the rest of the calendar is still read.
        ['UID:broken@example.com', `DTSTART:${utc(at(DAY))}`, 'RRULE:FREQ=SOMETIMES', 'SUMMARY:Broken', 'ATTENDEE:mailto:ann@customer.example'],
        ...(cal.intro ? [['UID:intro@example.com', `DTSTART:${utc(at(DAY))}`, `DTEND:${utc(later(at(DAY), HOUR))}`, 'SUMMARY:Intro call', 'ATTENDEE:mailto:ann@customer.example']] : []),
      ),
    );

  it('logs meetings with customers from a calendar address', async () => {
    publish();
    const res = await james('POST', '/api/integrations/ics', { url: web.base + PATH, label: 'Work calendar' });
    expect(res.statusCode).toBe(201);
    calendarId = res.json().id;
    expect(res.json()).toMatchObject({
      provider: 'ics',
      label: 'Work calendar',
      address: null,
      capabilities: { sendEmail: false, syncEmail: false, calendar: true, exportEvents: false },
      settings: { syncEmail: false, syncCalendar: true, unmatched: 'ignore', feedHost: '127.0.0.1' },
      status: 'active',
    });
    expect(res.json().settings).not.toHaveProperty('feedHash');
    // Calendar addresses often contain a secret: only the encrypted credentials have it.
    expect(JSON.stringify(await s.db.get('SELECT * FROM connected_accounts WHERE id = ?', [calendarId]))).not.toContain('s3cret');

    await s.jobs.drain();
    const items = await meetings();
    expect(titles(items)).toEqual(['Offsite', 'Quarterly review', 'Weekly check-in', 'Weekly check-in', 'Weekly check-in (moved)']);

    const review = items.find((i) => i.title === 'Quarterly review')!;
    expect(review).toMatchObject({ at: reviewStart.toISOString(), status: 'Completed', body: 'Agenda:\n- pricing\n- next steps' });
    expect(review.meeting).toEqual({
      start: reviewStart.toISOString(),
      end: later(reviewStart, HOUR).toISOString(),
      location: 'Room 4, HQ',
      attendees: ['ann@customer.example', 'bob@partner.example'],
      calendar: { provider: 'ics', direction: 'import' },
    });

    const weekly = items.filter((i) => i.title.startsWith('Weekly')).sort((a, b) => a.meeting!.start!.localeCompare(b.meeting!.start!));
    expect(weekly.map((i) => [i.meeting!.start, i.status])).toEqual([
      [weeklyStart.toISOString(), 'Completed'],
      [later(weeklyStart, 7 * DAY).toISOString(), 'Completed'],
      [later(weeklyStart, 21 * DAY + HOUR).toISOString(), 'Open'],
    ]);
    expect(items.find((i) => i.title === 'Offsite')).toMatchObject({
      status: 'Open',
      dueDate: date(offsite),
      meeting: { start: null, end: null, attendees: ['ann@customer.example'] },
    });

    expect(await sync(james, calendarId)).toEqual({ mail: null, calendar: { imported: 0, updated: 0, skipped: 9 }, error: null });
    expect((await meetings()).length).toBe(5);
  });

  it('applies changes, keeps deleted meetings deleted and logs new ones', async () => {
    const before = await meetings();
    const weekly = before.filter((i) => i.title === 'Weekly check-in').sort((a, b) => a.meeting!.start!.localeCompare(b.meeting!.start!));
    expect((await james('DELETE', `/api/records/activity/${weekly[1]!.recordId}`)).statusCode).toBe(200);
    Object.assign(cal, { reviewSummary: 'Quarterly review (moved)', reviewLocation: 'Zoom', offsiteStatus: 'CANCELLED', intro: true });
    publish();

    expect((await sync(james, calendarId)).calendar).toEqual({ imported: 1, updated: 2, skipped: 7 });
    const items = await meetings();
    expect(titles(items)).toEqual(['Canceled: Offsite', 'Intro call', 'Quarterly review (moved)', 'Weekly check-in', 'Weekly check-in (moved)']);
    expect(items.find((i) => i.title === 'Quarterly review (moved)')!.meeting!.location).toBe('Zoom');
    // A cancelled meeting keeps its details.
    expect(items.find((i) => i.title === 'Canceled: Offsite')).toMatchObject({ status: 'Open', dueDate: date(offsite) });
  });

  it('remembers logged events when the calendar is removed and connected again', async () => {
    const before = titles(await meetings());
    expect((await james('DELETE', `/api/integrations/accounts/${calendarId}`)).json()).toEqual({ ok: true });
    const removed = await meetings();
    expect(titles(removed)).toEqual(before);
    expect(removed.every((i) => i.meeting!.calendar === null)).toBe(true);

    const again = await james('POST', '/api/integrations/ics', { url: web.base + PATH, label: 'Work calendar' });
    expect(again.statusCode).toBe(201);
    calendarId = again.json().id;
    await s.jobs.drain();
    const items = await meetings();
    expect(titles(items)).toEqual(before);
    expect(items.every((i) => i.meeting!.calendar?.provider === 'ics')).toBe(true);
    const owners = await s.db.all<{ account_id: string | null }>('SELECT account_id FROM calendar_events WHERE user_id = ?', [(await demoUser(s, 'james')).id]);
    expect(owners.length).toBe(6);
    expect(owners.every((r) => r.account_id === calendarId)).toBe(true);
    expect((await sync(james, calendarId)).calendar).toEqual({ imported: 0, updated: 0, skipped: 10 });

    expect(errorOf(await james('POST', '/api/integrations/ics', { url: web.base + PATH }))).toEqual([409, 'This calendar is already connected']);
  });

  it('checks the address before subscribing', async () => {
    web.set('/page.html', '<!doctype html><title>Calendar</title>', { headers: { 'content-type': 'text/html' } });
    web.set('/loop-a', '', { status: 302, headers: { location: '/loop-b' } });
    web.set('/loop-b', '', { status: 302, headers: { location: '/loop-a' } });
    const port = new URL(web.base).port;
    for (const [url, message] of [
      ['not a url', 'Enter a valid calendar URL'],
      ['ftp://example.com/calendar.ics', 'Calendar URLs must start with https://, http:// or webcal://'],
      [`${web.base}/missing.ics`, `Could not load 127.0.0.1:${port}: HTTP 404`],
      [`${web.base}/page.html`, 'The address did not return an iCalendar (.ics) file'],
      [`${web.base}/loop-a`, 'Too many redirects'],
    ]) {
      expect(errorOf(await james('POST', '/api/integrations/ics', { url })), url).toEqual([400, message]);
    }

    // Redirects are followed, and an empty calendar is a calendar.
    web.set('/moved.ics', '', { status: 301, headers: { location: '/empty.ics' } });
    web.set('/empty.ics', ics());
    const moved = await priya('POST', '/api/integrations/ics', { url: `${web.base}/moved.ics` });
    expect(moved.statusCode).toBe(201);
    expect(moved.json()).toMatchObject({ label: '127.0.0.1', settings: { feedHost: '127.0.0.1' } });
    expect((await sync(priya, moved.json().id)).calendar).toEqual({ imported: 0, updated: 0, skipped: 0 });
  });

  it('does not reach private networks unless the server allows it', async () => {
    const strict = await createTestServices({ env: { ...INTEGRATION_ENV, TITO_ALLOW_PRIVATE_NETWORK: 'false' } });
    const strictApp = await buildApp(strict);
    try {
      const client = await signIn(strictApp, 'james');
      const port = new URL(web.base).port;
      for (const [url, message] of [
        [web.base + PATH, `Could not load 127.0.0.1:${port}: the address is on a private network`],
        [`http://[::1]:${port}/work.ics`, `Could not load [::1]:${port}: the address is on a private network`],
        ['http://169.254.169.254/latest/meta-data/', 'Could not load 169.254.169.254: the address is on a private network'],
        // Host names are checked when they are resolved, for every connection.
        [`http://localhost:${port}/work.ics`, `Could not load localhost:${port}: localhost is on a private network`],
      ]) {
        expect(errorOf(await client('POST', '/api/integrations/ics', { url })), url).toEqual([400, message]);
      }
    } finally {
      await strictApp.close();
      await strict.close();
    }
  });
});

describe('meetings logged in the CRM', () => {
  it('logs a meeting on the record without a calendar', async () => {
    const start = at(3 * DAY);
    const res = await james('POST', '/api/meetings', {
      recordId: ann,
      subject: '  Planning   session ',
      start: start.toISOString(),
      end: later(start, HOUR).toISOString(),
      location: 'HQ',
      description: 'Agenda\r\n1. Scope',
      attendees: ['Ann@Customer.example', 'ann@customer.example', ' carl@customer.example '],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ calendar: null, calendarError: null });
    const activity = await s.records.get(await principal(s, 'james'), 'activity', res.json().activityId);
    expect(activity.fields).toMatchObject({
      subject: 'Planning session',
      type: 'Meeting',
      status: 'Open',
      due_date: date(start),
      location: 'HQ',
      description: 'Agenda\n1. Scope',
      attendees: 'ann@customer.example\ncarl@customer.example',
      related_to: ann,
    });
    expect((await meetings()).find((i) => i.recordId === activity.id)!.meeting).toEqual({
      start: start.toISOString(),
      end: later(start, HOUR).toISOString(),
      location: 'HQ',
      attendees: ['ann@customer.example', 'carl@customer.example'],
      calendar: null,
    });

    const past = await james('POST', '/api/meetings', { recordId: ann, subject: 'Lunch', start: at(-2 * DAY).toISOString(), end: later(at(-2 * DAY), HOUR).toISOString() });
    expect((await s.records.get(await principal(s, 'james'), 'activity', past.json().activityId)).fields.status).toBe('Completed');
  });

  it('checks the meeting and the calendar before logging anything', async () => {
    const start = at(DAY);
    const valid = { recordId: ann, subject: 'Demo', start: start.toISOString(), end: later(start, HOUR).toISOString() };
    const priyaCalendar = (await priya('GET', '/api/integrations/accounts')).json()[0].id;
    const noah = await signIn(app, 'noah');
    const cases: [ApiClient, object, number, string][] = [
      [james, { subject: '   ' }, 400, 'Subject is required'],
      [james, { start: 'next tuesday' }, 400, 'Start is not a valid date and time'],
      [james, { end: start.toISOString() }, 400, 'The meeting must end after it starts'],
      [james, { end: later(start, 15 * DAY).toISOString() }, 400, 'A meeting can last at most 14 days'],
      [james, { attendees: ['ann@customer.example', 'not-an-email'] }, 400, 'Attendees: "not-an-email" is not a valid email address'],
      [james, { attendees: ['ann@customer.example'], sendInvites: true }, 400, 'Choose a calendar to send the invitations from'],
      [james, { accountId: calendarId }, 400, 'Work calendar cannot add events to a calendar'],
      [james, { accountId: priyaCalendar }, 404, 'Account not found'],
      [noah, {}, 404, 'Record not found'],
    ];
    for (const [client, patch, status, message] of cases) {
      expect(errorOf(await client('POST', '/api/meetings', { ...valid, ...patch })), message).toEqual([status, message]);
    }
    expect(await s.db.all("SELECT id FROM records WHERE object_api_name = 'activity' AND name = 'Demo'")).toEqual([]);
  });
});

describe('calendar feed', () => {
  const LONG = 'Überprüfung der Verträge für das nächste Geschäftsjahr — alle Beteiligten, Teil 2';

  it('publishes the calls, meetings and tasks of its owner', async () => {
    const as = await principal(s, 'james');
    const due = date(at(2 * DAY));
    const call = at(-DAY);
    const task = await s.records.create(as, 'activity', { subject: 'Send proposal', type: 'Task', due_date: due, related_to: ann, description: 'Include the discount; ask for a PO\\number' });
    await s.records.create(as, 'activity', { subject: 'Follow-up call', type: 'Call', status: 'Completed', due_date: date(call), start_time: call.toISOString(), end_time: later(call, HOUR / 4).toISOString() });
    await s.records.create(as, 'activity', { subject: LONG, type: 'Task', due_date: due });
    await s.records.create(as, 'activity', { subject: 'A note', type: 'Note', due_date: due });
    await s.records.create(as, 'activity', { subject: 'Ancient task', type: 'Task', due_date: date(at(-200 * DAY)) });
    await s.records.create(await principal(s, 'priya'), 'activity', { subject: "Priya's task", type: 'Task', due_date: due });

    expect((await james('GET', '/api/integrations/status')).json().calendarFeed).toEqual({ enabled: false });
    const { url } = (await james('POST', '/api/integrations/calendar-feed')).json();
    expect(url).toMatch(/^https:\/\/crm\.example\.com\/api\/calendar\/feed\/[\w-]{32}\.ics$/);
    expect((await james('GET', '/api/integrations/status')).json().calendarFeed).toEqual({ enabled: true });

    // Calendar apps fetch it without a session.
    const res = await app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.body.split('\r\n').filter((l) => Buffer.byteLength(l) > 75)).toEqual([]);

    const events = parseIcs(res.body, { from: at(-400 * DAY), to: at(400 * DAY), self: [] });
    const names = events.map((e) => e.title);
    expect(names).toEqual(expect.arrayContaining(['Send proposal', LONG, '✓ Follow-up call', 'Planning session', '✓ Lunch']));
    // Not notes, not out of range, not someone else's, and not meetings that are in a connected calendar already.
    for (const hidden of ['A note', 'Ancient task', "Priya's task", 'Quarterly review (moved)', 'Intro call', 'Weekly check-in']) expect(names).not.toContain(hidden);
    expect(events.find((e) => e.title === 'Send proposal')).toMatchObject({
      key: `${task.id}@titoforce`,
      allDay: true,
      start: due,
      end: date(later(new Date(`${due}T00:00:00Z`), DAY)),
      description: `Related to: Ann Customer\n\nInclude the discount; ask for a PO\\number\n\nhttps://crm.example.com/r/${task.id}`,
    });
    expect(events.find((e) => e.title === '✓ Follow-up call')).toMatchObject({ allDay: false, start: call.toISOString(), end: later(call, HOUR / 4).toISOString() });
    expect(events.find((e) => e.title === 'Planning session')).toMatchObject({ location: 'HQ' });
  });

  it('stops working when it is replaced or turned off', async () => {
    const first = new URL((await james('POST', '/api/integrations/calendar-feed')).json().url).pathname;
    const second = new URL((await james('POST', '/api/integrations/calendar-feed')).json().url).pathname;
    expect(errorOf(await app.inject({ method: 'GET', url: first }))).toEqual([404, 'Calendar not found']);
    expect((await app.inject({ method: 'GET', url: second })).statusCode).toBe(200);
    expect((await james('DELETE', '/api/integrations/calendar-feed')).json()).toEqual({ ok: true });
    expect(errorOf(await app.inject({ method: 'GET', url: second }))).toEqual([404, 'Calendar not found']);
    expect((await app.inject({ method: 'GET', url: '/api/calendar/feed/short.ics' })).statusCode).toBe(404);
  });
});

describe('scheduled syncs', () => {
  it('syncs the active accounts of active users once the interval has passed', async () => {
    await s.jobs.drain();
    const rows = await s.db.all<{ id: string; user_id: string; last_sync_at: string }>('SELECT id, user_id, last_sync_at FROM connected_accounts ORDER BY created_at');
    expect(rows.length).toBe(2);
    const synced = rows.map((r) => Date.parse(r.last_sync_at));
    expect(await s.integrations.syncDue(Math.min(...synced))).toBe(0);
    expect(await s.integrations.syncDue(Math.max(...synced) + 1)).toBe(2);
    await s.jobs.drain();

    const priyaId = (await demoUser(s, 'priya')).id;
    const { url } = await s.integrations.calendar.createFeed(priyaId);
    await s.db.run("UPDATE connected_accounts SET status = 'error' WHERE id = ?", [calendarId]);
    await s.users.updateUser(priyaId, { active: false });
    try {
      expect(await s.integrations.syncDue(Date.now() + 60_000)).toBe(0);
      expect((await app.inject({ method: 'GET', url: new URL(url).pathname })).statusCode).toBe(404);
    } finally {
      await s.users.updateUser(priyaId, { active: true });
    }
    expect((await app.inject({ method: 'GET', url: new URL(url).pathname })).statusCode).toBe(200);
  });
});

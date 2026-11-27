import { createHash } from 'node:crypto';
import type { TimelineItem } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import PostalMime from 'postal-mime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { OAuthCredentials } from '../src/integrations/oauth.ts';
import type { Services } from '../src/services.ts';
import { createTestServices, principal } from './helpers.ts';
import { type ApiClient, FakeHttp, type FakeRequest, INTEGRATION_ENV, rfc822, signIn } from './integration-fakes.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GMAIL = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me/;
const GOOGLE_TOKEN = /^https:\/\/oauth2\.googleapis\.com\/token$/;
const MS_TOKEN = /^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token$/;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const G = 'https://www.googleapis.com/auth/';
const GOOGLE_SCOPE = ['openid', `${G}userinfo.email`, `${G}gmail.send`, `${G}gmail.readonly`, `${G}calendar.events`].join(' ');

const http = new FakeHttp();
let s: Services;
let app: FastifyInstance;
let james: ApiClient;
let priya: ApiClient;
let ann: string;

beforeAll(async () => {
  s = await createTestServices({ env: INTEGRATION_ENV, fetchImpl: http.fetch });
  app = await buildApp(s);
  james = await signIn(app, 'james');
  priya = await signIn(app, 'priya');
  ann = (await s.records.create(await principal(s, 'james'), 'contact', { first_name: 'Ann', last_name: 'Customer', email: 'ann@customer.example' })).id;
});
afterAll(async () => {
  await app?.close();
  await s?.close();
});

// ---------- helpers ----------

/** A canned reply, or a function for replies that are not JSON 200s (a Response can only be read once). */
type Reply = unknown;
const answer = (r: Reply, fallback: () => Response) => (typeof r === 'function' ? (r as () => Response)() : (r ?? fallback()));
const bearer = (req: FakeRequest) => req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';

/** An OAuth token endpoint: authorization codes and refresh tokens map to token responses. */
function tokenEndpoint(codes: Map<string, Reply>, refresh: Map<string, Reply>) {
  return (req: FakeRequest) => {
    const form = new URLSearchParams(req.body);
    const r = form.get('grant_type') === 'authorization_code' ? codes.get(form.get('code') ?? '') : refresh.get(form.get('refresh_token') ?? '');
    return answer(r, () => Response.json({ error: 'invalid_grant', error_description: 'Unknown code' }, { status: 400 }));
  };
}

function redirectParams(res: { statusCode: number; headers: Record<string, unknown> }): Record<string, string> {
  expect(res.statusCode).toBe(302);
  const url = new URL(String(res.headers.location), 'https://crm.example.com');
  expect(url.pathname).toBe('/settings');
  return Object.fromEntries(url.searchParams);
}

/** Runs the browser part of a sign-in: start, consent (skipped), callback. Waits for the first sync. */
async function connect(client: ApiClient, provider: 'google' | 'microsoft', code: string) {
  const start = await client('POST', `/api/integrations/oauth/${provider}/start`);
  expect(start.statusCode).toBe(200);
  const authorize = new URL(start.json().url);
  const callback = await client('GET', `/api/integrations/oauth/${provider}/callback?${new URLSearchParams({ code, state: authorize.searchParams.get('state')! })}`);
  const outcome = redirectParams(callback);
  await s.jobs.drain();
  return { authorize, outcome };
}

async function sync(client: ApiClient, id: string) {
  await s.jobs.drain();
  const res = await client('POST', `/api/integrations/accounts/${id}/sync`);
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function timeline(client: ApiClient, object: string, id: string): Promise<TimelineItem[]> {
  const res = await client('GET', `/api/records/${object}/${id}/timeline`);
  expect(res.statusCode).toBe(200);
  return res.json().items;
}
const emailItem = (items: TimelineItem[], subject: string) => items.find((i) => i.email?.subject === subject);

const credentials = async (id: string) => s.integrations.accounts.credentials<OAuthCredentials>((await s.integrations.accounts.get(id))!);
const expireToken = async (id: string) => s.integrations.accounts.saveCredentials(id, { ...(await credentials(id)), expiresAt: Date.now() - 1000 });
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** A whole hour, `offset` from now. */
function at(offset: number): Date {
  const d = new Date(Date.now() + offset);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** RFC 3339 with a UTC offset, as Google returns event times. */
function withOffset(d: Date, hours: number): string {
  const local = new Date(d.getTime() + hours * HOUR).toISOString().slice(0, 19);
  return `${local}${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

function headersOf(raw: Buffer): { name: string; value: string }[] {
  const head = raw.toString().split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, ' ');
  return head.split(/\r?\n/).map((line) => ({ name: line.slice(0, line.indexOf(':')), value: line.slice(line.indexOf(':') + 1).trim() }));
}

describe('integration status for administrators', () => {
  it('lists what is configured and the addresses to register with the providers', async () => {
    const admin = await signIn(app, 'admin');
    const res = await admin('GET', '/api/integrations/admin');
    expect(res.json()).toMatchObject({
      publicUrl: 'https://crm.example.com',
      secretKey: true,
      smtpRelay: { configured: true, from: 'crm@titoforce.example' },
      google: true,
      microsoft: true,
      twilio: {
        configured: true,
        number: '+14155550000',
        inboundWebhook: 'https://crm.example.com/api/telephony/twilio/voice',
        statusWebhook: 'https://crm.example.com/api/telephony/twilio/status',
      },
      oauthRedirects: {
        google: 'https://crm.example.com/api/integrations/oauth/google/callback',
        microsoft: 'https://crm.example.com/api/integrations/oauth/microsoft/callback',
      },
      accounts: [],
    });
    expect((await james('GET', '/api/integrations/admin')).statusCode).toBe(403);
    expect((await james('GET', '/api/integrations/status')).json().oauth).toEqual({ google: true, microsoft: true });
  });
});

describe('Google accounts', () => {
  const ADDRESS = 'james.chen@gmail.example';
  const codes = new Map<string, Reply>();
  const refresh = new Map<string, Reply>();
  const people = new Map<string, Reply>();
  const gmail = {
    messages: new Map<string, { labelIds: string[]; raw: Buffer }>(),
    listed: [] as string[],
    history: [] as string[],
    historyGone: false,
    historyId: '1000',
    lastSent: '',
  };
  let events: Record<string, unknown>[] = [];
  let refuseEvents = false;
  let eventIds = 0;
  let accountId: string;
  const callStart = at(-2 * DAY);

  const event = (id: string, summary: string, start: Date, attendees: object[], extra: object = {}) => ({
    id,
    iCalUID: `${id}@google.com`,
    status: 'confirmed',
    summary,
    start: { dateTime: withOffset(start, -5) },
    end: { dateTime: withOffset(new Date(start.getTime() + HOUR), -5) },
    organizer: { email: ADDRESS },
    attendees,
    ...extra,
  });

  beforeAll(() => {
    const CALENDAR = /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events$/;
    const CALENDAR_EVENT = /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events\/[^/]+$/;
    http
      .on('POST', GOOGLE_TOKEN, tokenEndpoint(codes, refresh))
      .on('GET', /^https:\/\/openidconnect\.googleapis\.com\/v1\/userinfo$/, (req) => answer(people.get(bearer(req)), () => Response.json({ error: 'invalid_token' }, { status: 401 })))
      .on('POST', /^https:\/\/oauth2\.googleapis\.com\/revoke$/, () => new Response(null, { status: 200 }))
      .on('GET', /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/profile$/, () => ({ emailAddress: ADDRESS, historyId: gmail.historyId }))
      // Newest first, like Gmail.
      .on('GET', /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages$/, () => ({ messages: [...gmail.listed].reverse().map((id) => ({ id, threadId: id })) }))
      .on('GET', /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/history$/, () =>
        gmail.historyGone
          ? Response.json({ error: { code: 404, message: 'Requested entity was not found.' } }, { status: 404 })
          : { history: gmail.history.map((id) => ({ id, messagesAdded: [{ message: { id } }] })), historyId: gmail.historyId },
      )
      .on('GET', /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/[^/]+$/, (req) => {
        const id = decodeURIComponent(req.url.pathname.split('/').at(-1)!);
        const m = gmail.messages.get(id);
        if (!m) return Response.json({ error: { code: 404, message: 'Requested entity was not found.' } }, { status: 404 });
        if (req.url.searchParams.get('format') === 'raw') return { id, labelIds: m.labelIds, raw: m.raw.toString('base64url') };
        const wanted = req.url.searchParams.getAll('metadataHeaders').map((h) => h.toLowerCase());
        return { id, labelIds: m.labelIds, payload: { headers: headersOf(m.raw).filter((h) => wanted.includes(h.name.toLowerCase())) } };
      })
      .on('POST', /^https:\/\/gmail\.googleapis\.com\/upload\/gmail\/v1\/users\/me\/messages\/send$/, (req) => {
        const id = `sent-${gmail.messages.size + 1}`;
        // Gmail may replace the Message-ID of a message it sends.
        gmail.messages.set(id, { labelIds: ['SENT'], raw: Buffer.from(req.raw.toString().replace(/^Message-ID: .*$/im, `Message-ID: <${id}@mail.gmail.com>`)) });
        gmail.lastSent = id;
        return { id, threadId: id, labelIds: ['SENT'] };
      })
      .on('GET', CALENDAR, () => ({ items: events }))
      .on('POST', CALENDAR, (req) => {
        if (refuseEvents) return Response.json({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, { status: 403 });
        eventIds++;
        return { id: `gev-${eventIds}`, iCalUID: `gev-${eventIds}@google.com`, ...JSON.parse(req.body) };
      })
      .on('PATCH', CALENDAR_EVENT, (req) => JSON.parse(req.body))
      .on('DELETE', CALENDAR_EVENT, () => new Response(null, { status: 204 }));
  });

  it('connects with PKCE, then logs mail and meetings with customers', async () => {
    gmail.messages.set('m1', {
      labelIds: ['INBOX', 'UNREAD'],
      raw: rfc822({ from: 'Ann Customer <ann@customer.example>', to: ADDRESS, subject: 'Question about pricing', messageId: '<g-1@customer.example>', date: at(-3 * DAY) }),
    });
    gmail.messages.set('m2', { labelIds: ['SPAM'], raw: rfc822({ from: 'Ann Customer <ann@customer.example>', to: ADDRESS, subject: 'You won a prize', messageId: '<g-spam@customer.example>' }) });
    gmail.messages.set('m3', {
      labelIds: ['SENT'],
      raw: rfc822({ from: `James Chen <${ADDRESS}>`, to: 'ann@customer.example', subject: 'Re: Question about pricing', messageId: '<g-3@gmail.example>', inReplyTo: '<g-1@customer.example>' }),
    });
    gmail.listed = ['m1', 'm2', 'm3'];
    events = [
      event('ge1', 'Pricing call', callStart, [
        { email: ADDRESS, self: true, responseStatus: 'accepted' },
        { email: 'Ann@Customer.example', displayName: 'Ann Customer' },
        { email: 'c_1@resource.calendar.google.com', resource: true },
      ], { location: 'Google Meet', description: '<p>Agenda:<br>prices</p>' }),
      event('ge2', 'Team sync', at(-DAY), [{ email: ADDRESS, self: true }, { email: 'maria@titoforce.example' }]),
      event('ge3', 'Declined demo', at(DAY), [{ email: ADDRESS, self: true, responseStatus: 'declined' }, { email: 'ann@customer.example' }]),
      // Cancelled occurrences can come without any details.
      { id: 'ge4', status: 'cancelled' },
    ];
    codes.set('code-1', { access_token: 'g-access-1', refresh_token: 'g-refresh-1', expires_in: 3599, scope: GOOGLE_SCOPE, token_type: 'Bearer' });
    people.set('g-access-1', { sub: '1', email: 'James.Chen@Gmail.example', name: 'James Chen' });

    const { authorize, outcome } = await connect(james, 'google', 'code-1');
    expect(authorize.origin + authorize.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: 'google-client',
      redirect_uri: 'https://crm.example.com/api/integrations/oauth/google/callback',
      response_type: 'code',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });
    expect(authorize.searchParams.get('scope')!.split(' ')).toEqual(expect.arrayContaining([`${G}gmail.send`, `${G}gmail.readonly`, `${G}calendar.events`]));
    expect(outcome).toEqual({ connected: ADDRESS });

    const token = Object.fromEntries(new URLSearchParams(http.find('POST', GOOGLE_TOKEN)[0]!.body));
    expect(token).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code-1',
      client_id: 'google-client',
      client_secret: 'google-secret',
      redirect_uri: 'https://crm.example.com/api/integrations/oauth/google/callback',
    });
    expect(challengeOf(token.code_verifier!)).toBe(authorize.searchParams.get('code_challenge'));

    const accounts = (await james('GET', '/api/integrations/accounts')).json();
    expect(accounts).toHaveLength(1);
    accountId = accounts[0].id;
    expect(accounts[0]).toMatchObject({
      provider: 'google',
      label: ADDRESS,
      address: ADDRESS,
      status: 'active',
      lastError: null,
      capabilities: { sendEmail: true, syncEmail: true, calendar: true, exportEvents: true },
      settings: { syncEmail: true, syncCalendar: true, unmatched: 'ignore' },
    });
    expect(accounts[0].settings).not.toHaveProperty('scope');
    const row = await s.db.get('SELECT * FROM connected_accounts WHERE id = ?', [accountId]);
    expect(JSON.stringify(row)).not.toMatch(/g-access-1|g-refresh-1/);

    // The first sync looked back two weeks; spam was never downloaded.
    const list = http.find('GET', /gmail\/v1\/users\/me\/messages$/)[0]!;
    expect(list.url.searchParams.get('q')).toMatch(/^after:\d+ -in:spam -in:trash -in:drafts -in:chats$/);
    expect(list.headers.get('authorization')).toBe('Bearer g-access-1');
    expect(http.find('GET', /messages\/m2$/).map((r) => r.url.searchParams.get('format'))).toEqual(['metadata']);

    const items = await timeline(james, 'contact', ann);
    expect(emailItem(items, 'Question about pricing')!.email).toMatchObject({ direction: 'inbound', status: 'received', provider: 'google', from: 'ann@customer.example' });
    expect(emailItem(items, 'Re: Question about pricing')!.email).toMatchObject({ direction: 'outbound', status: 'sent', to: ['ann@customer.example'] });
    expect(emailItem(items, 'You won a prize')).toBeUndefined();

    // Only the meeting with a customer is logged: not the internal one, the declined one or the cancelled one.
    expect(items.filter((i) => i.activityType === 'Meeting').map((i) => i.title)).toEqual(['Pricing call']);
    const meeting = items.find((i) => i.title === 'Pricing call')!;
    expect(meeting.status).toBe('Completed');
    expect(meeting.meeting).toEqual({
      start: callStart.toISOString(),
      end: new Date(callStart.getTime() + HOUR).toISOString(),
      location: 'Google Meet',
      attendees: ['ann@customer.example'],
      calendar: { provider: 'google', direction: 'import' },
    });
    const activity = await s.records.get(await principal(s, 'james'), 'activity', meeting.recordId!);
    expect(activity.fields.description).toMatch(/^Agenda:\s+prices$/);
  });

  it('follows the Gmail history on later syncs and applies changes to logged meetings', async () => {
    gmail.messages.set('m4', {
      labelIds: ['INBOX'],
      raw: rfc822({ from: 'Ann Customer <ann@customer.example>', to: ADDRESS, subject: 'Re: Re: Question about pricing', messageId: '<g-4@customer.example>', inReplyTo: '<g-3@gmail.example>' }),
    });
    gmail.history = ['m1', 'm4'];
    gmail.historyId = '1010';
    events[0] = { ...events[0], summary: 'Pricing call (moved)', location: 'Zoom' };

    const { result } = await sync(james, accountId);
    expect(result).toEqual({ mail: { logged: 1, duplicates: 1, skipped: 0 }, calendar: { imported: 0, updated: 1, skipped: 2 }, error: null });
    const history = http.find('GET', /gmail\/v1\/users\/me\/history$/).at(-1)!;
    expect(Object.fromEntries(history.url.searchParams)).toMatchObject({ startHistoryId: '1000', historyTypes: 'messageAdded' });
    expect((await s.integrations.accounts.get(accountId))!.syncState.gmail).toEqual({ historyId: '1010' });

    const items = await timeline(james, 'contact', ann);
    expect(emailItem(items, 'Re: Re: Question about pricing')).toBeDefined();
    expect(items.find((i) => i.activityType === 'Meeting')).toMatchObject({ title: 'Pricing call (moved)', meeting: { location: 'Zoom' } });
  });

  it('searches recent mail when Gmail no longer has the history', async () => {
    const { mailSyncedAt } = (await s.integrations.accounts.get(accountId))!.syncState;
    gmail.historyGone = true;
    gmail.listed = ['m1', 'm2', 'm3', 'm4'];
    try {
      expect((await sync(james, accountId)).result.mail).toEqual({ logged: 0, duplicates: 3, skipped: 0 });
    } finally {
      gmail.historyGone = false;
    }
    const since = Math.floor(Date.parse(mailSyncedAt!) / 1000) - 3600;
    expect(http.find('GET', /gmail\/v1\/users\/me\/messages$/).at(-1)!.url.searchParams.get('q')).toBe(`after:${since} -in:spam -in:trash -in:drafts -in:chats`);
  });

  it('claims an account before awaiting its lookup so overlapping syncs are rejected', async () => {
    const accounts = s.integrations.accounts;
    const originalGet = accounts.get.bind(accounts);
    let entered!: () => void;
    let release!: (account: Awaited<ReturnType<typeof originalGet>>) => void;
    const lookupStarted = new Promise<void>((resolve) => { entered = resolve; });
    const lookup = new Promise<Awaited<ReturnType<typeof originalGet>>>((resolve) => { release = resolve; });
    accounts.get = async () => {
      entered();
      return lookup;
    };

    const pending = s.integrations.syncAccount(accountId);
    try {
      await lookupStarted;
      expect(accounts.syncing.has(accountId)).toBe(true);
      expect(await s.integrations.syncAccount(accountId)).toBeNull();
    } finally {
      accounts.get = originalGet;
      release(await originalGet(accountId));
    }
    expect(await pending).not.toBeNull();
  });

  it('releases the sync claim when an account lookup is missing or fails', async () => {
    const accounts = s.integrations.accounts;
    const originalGet = accounts.get.bind(accounts);
    accounts.get = async (id) => {
      if (id === 'missing-account') return undefined;
      throw new Error('lookup failed');
    };
    try {
      expect(await s.integrations.syncAccount('missing-account')).toBeNull();
      expect(accounts.syncing.has('missing-account')).toBe(false);
      await expect(s.integrations.syncAccount(accountId)).rejects.toThrow('lookup failed');
      expect(accounts.syncing.has(accountId)).toBe(false);
    } finally {
      accounts.get = originalGet;
    }
  });

  it('sends through Gmail and keeps the Message-ID Gmail gave the email', async () => {
    const res = await james('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Contract', body: 'The contract is attached.' });
    expect(res.json()).toMatchObject({ status: 'sent', via: 'account', from: ADDRESS });
    const upload = http.find('POST', /upload\/gmail\/v1\/users\/me\/messages\/send$/).at(-1)!;
    expect(upload.url.searchParams.get('uploadType')).toBe('media');
    expect(upload.headers.get('content-type')).toBe('message/rfc822');
    expect(upload.headers.get('authorization')).toBe('Bearer g-access-1');
    const parsed = await PostalMime.parse(upload.raw);
    expect(parsed.from).toMatchObject({ name: 'James Chen', address: ADDRESS });
    expect(parsed.replyTo).toBeUndefined();
    expect(await s.db.get('SELECT message_id, provider FROM email_messages WHERE subject = ?', ['Contract'])).toEqual({
      message_id: `<${gmail.lastSent}@mail.gmail.com>`,
      provider: 'google',
    });

    // Its copy in Sent is not logged a second time.
    gmail.history = [gmail.lastSent];
    expect((await sync(james, accountId)).result.mail).toEqual({ logged: 0, duplicates: 1, skipped: 0 });
  });

  it('adds meetings created in the CRM to the calendar and keeps the event up to date', async () => {
    const start = at(2 * DAY);
    const end = new Date(start.getTime() + HOUR);
    const res = await james('POST', '/api/meetings', {
      recordId: ann,
      subject: 'Kickoff',
      start: start.toISOString(),
      end: end.toISOString(),
      location: 'HQ',
      attendees: ['ann@customer.example', 'Carl@Customer.example', 'ann@customer.example'],
      accountId,
      sendInvites: true,
    });
    expect(res.statusCode).toBe(201);
    const { activityId, calendar, calendarError } = res.json();
    expect({ calendar, calendarError }).toEqual({ calendar: { accountId, provider: 'google' }, calendarError: null });
    const created = http.find('POST', /calendars\/primary\/events$/).at(-1)!;
    expect(created.url.searchParams.get('sendUpdates')).toBe('all');
    expect(JSON.parse(created.body)).toEqual({
      summary: 'Kickoff',
      location: 'HQ',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: [{ email: 'ann@customer.example' }, { email: 'carl@customer.example' }],
    });
    expect((await timeline(james, 'contact', ann)).find((i) => i.recordId === activityId)!.meeting).toEqual({
      start: start.toISOString(),
      end: end.toISOString(),
      location: 'HQ',
      attendees: ['ann@customer.example', 'carl@customer.example'],
      calendar: { provider: 'google', direction: 'export' },
    });

    const jamesP = await principal(s, 'james');
    await s.records.update(jamesP, 'activity', activityId, { location: 'Room 2' });
    await s.jobs.drain();
    const patch = http.find('PATCH', /calendars\/primary\/events\/gev-\d+$/).at(-1)!;
    expect(patch.url.pathname).toMatch(new RegExp(`/events/gev-${eventIds}$`));
    expect(patch.url.searchParams.get('sendUpdates')).toBe('all');
    expect(JSON.parse(patch.body)).toMatchObject({ location: 'Room 2', attendees: [{ email: 'ann@customer.example' }, { email: 'carl@customer.example' }] });

    // The calendar returns the event on the next sync; it is the same meeting, not a new one.
    events.push(event(`gev-${eventIds}`, 'Kickoff', start, [{ email: ADDRESS, self: true }, { email: 'ann@customer.example' }], { iCalUID: `gev-${eventIds}@google.com` }));
    gmail.history = [];
    expect((await sync(james, accountId)).result.calendar).toEqual({ imported: 0, updated: 0, skipped: 4 });

    await s.records.delete(jamesP, 'activity', activityId);
    await s.jobs.drain();
    const removed = http.find('DELETE', /calendars\/primary\/events\/gev-\d+$/).at(-1)!;
    expect(removed.url.pathname).toMatch(new RegExp(`/events/gev-${eventIds}$`));
    expect(removed.url.searchParams.get('sendUpdates')).toBe('all');

    // When the calendar refuses the event, the meeting is still logged.
    refuseEvents = true;
    try {
      const refused = await james('POST', '/api/meetings', { recordId: ann, subject: 'Lunch', start: start.toISOString(), end: end.toISOString(), accountId });
      expect(refused.statusCode).toBe(201);
      expect(refused.json()).toMatchObject({
        calendar: null,
        calendarError: `The meeting was logged, but ${ADDRESS} did not accept it: Google returned HTTP 403: Request had insufficient authentication scopes.`,
      });
      expect((await timeline(james, 'contact', ann)).some((i) => i.title === 'Lunch')).toBe(true);
    } finally {
      refuseEvents = false;
    }
  });

  it('refreshes an expired access token once and keeps the refresh token', async () => {
    await expireToken(accountId);
    refresh.set('g-refresh-1', { access_token: 'g-access-2', expires_in: 3599, scope: GOOGLE_SCOPE, token_type: 'Bearer' });
    const before = http.find('POST', GOOGLE_TOKEN).length;
    const account = (await s.integrations.accounts.get(accountId))!;
    expect(await Promise.all([s.integrations.accounts.accessToken(account), s.integrations.accounts.accessToken(account)])).toEqual(['g-access-2', 'g-access-2']);
    const refreshes = http.find('POST', GOOGLE_TOKEN).slice(before);
    expect(refreshes).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(refreshes[0]!.body))).toEqual({
      client_id: 'google-client',
      client_secret: 'google-secret',
      grant_type: 'refresh_token',
      refresh_token: 'g-refresh-1',
    });
    const stored = await credentials(accountId);
    expect(stored).toMatchObject({ accessToken: 'g-access-2', refreshToken: 'g-refresh-1', scope: GOOGLE_SCOPE });
    expect(stored.expiresAt).toBeGreaterThan(Date.now() + 50 * 60_000);
  });

  it('asks the user to connect again when Google revokes access', async () => {
    await expireToken(accountId);
    refresh.set('g-refresh-1', () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 }));
    const message = 'Reconnect required: Google no longer accepts the stored sign-in (Token has been expired or revoked.)';
    const { result, account } = await sync(james, accountId);
    // The calendar is not tried with a sign-in that is known to be gone.
    expect(result).toEqual({ mail: null, calendar: null, error: `Email: ${message}` });
    expect(account).toMatchObject({ status: 'error', lastError: `Email: ${message}` });

    const send = await james('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Will not leave', body: 'x' });
    expect([send.statusCode, send.json().error.message]).toEqual([409, message]);
    expect(emailItem(await timeline(james, 'contact', ann), 'Will not leave')).toBeUndefined();

    // Connecting the same mailbox again repairs the account instead of adding one.
    codes.set('code-2', { access_token: 'g-access-3', refresh_token: 'g-refresh-2', expires_in: 3599, scope: GOOGLE_SCOPE, token_type: 'Bearer' });
    people.set('g-access-3', { sub: '1', email: ADDRESS, name: 'James Chen' });
    expect((await connect(james, 'google', 'code-2')).outcome).toEqual({ connected: ADDRESS });
    const accounts = (await james('GET', '/api/integrations/accounts')).json();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: accountId, status: 'active', lastError: null });
    expect(await credentials(accountId)).toMatchObject({ accessToken: 'g-access-3', refreshToken: 'g-refresh-2' });
  });

  it('only offers what the user granted', async () => {
    codes.set('priya-1', { access_token: 'g-priya-1', refresh_token: 'g-priya-r', expires_in: 3599, scope: `openid ${G}userinfo.email ${G}gmail.send` });
    people.set('g-priya-1', { email: 'priya.patel@gmail.example', name: 'Priya Patel' });
    expect((await connect(priya, 'google', 'priya-1')).outcome).toEqual({ connected: 'priya.patel@gmail.example' });
    const [account] = (await priya('GET', '/api/integrations/accounts')).json();
    expect(account).toMatchObject({
      capabilities: { sendEmail: true, syncEmail: false, calendar: false, exportEvents: false },
      settings: { syncEmail: false, syncCalendar: false },
    });
    expect((await priya('PATCH', `/api/integrations/accounts/${account.id}`, { syncCalendar: true })).json().error.message).toBe('This account cannot sync a calendar');
    expect((await priya('PATCH', `/api/integrations/accounts/${account.id}`, { syncEmail: true })).json().error.message).toBe('This account cannot sync email');
    const start = at(DAY);
    const meeting = await priya('POST', '/api/meetings', { recordId: ann, subject: 'Demo', start: start.toISOString(), end: new Date(start.getTime() + HOUR).toISOString(), accountId: account.id });
    expect([meeting.statusCode, meeting.json().error.message]).toEqual([400, 'priya.patel@gmail.example cannot add events to a calendar']);

    codes.set('priya-2', { access_token: 'g-priya-2', expires_in: 3599, scope: `openid ${G}userinfo.email` });
    people.set('g-priya-2', { email: 'priya.other@gmail.example', name: 'Priya Patel' });
    expect((await connect(priya, 'google', 'priya-2')).outcome).toEqual({
      integrationError: 'No mail or calendar access was granted. Connect again and allow the requested permissions.',
    });
    expect((await priya('GET', '/api/integrations/accounts')).json()).toHaveLength(1);
  });

  it('reports failed sign-ins on the Settings page', async () => {
    const callback = (client: ApiClient | null, provider: string, query: Record<string, string>) => {
      const url = `/api/integrations/oauth/${provider}/callback?${new URLSearchParams(query)}`;
      return client ? client('GET', url) : app.inject({ method: 'GET', url });
    };
    expect(redirectParams(await callback(james, 'google', { error: 'access_denied', state: 'x' }))).toEqual({ integrationError: 'Access was not granted.' });
    // Microsoft separates diagnostics with CRLF; only the first line is shown.
    const aad = await callback(james, 'microsoft', {
      error: 'invalid_request',
      error_description: "AADSTS900144: The request body must contain the following parameter: 'client_id'.\r\nTrace ID: 1\r\nCorrelation ID: 2",
    });
    expect(redirectParams(aad)).toEqual({ integrationError: "AADSTS900144: The request body must contain the following parameter: 'client_id'." });
    expect(redirectParams(await callback(null, 'google', { code: 'c', state: 's' }))).toEqual({
      integrationError: 'Your session has expired. Sign in and connect the account again.',
    });
    expect(redirectParams(await callback(james, 'google', { state: 's' }))).toEqual({ integrationError: 'The sign-in response was incomplete. Please try again.' });
    const expired = { integrationError: 'This sign-in has expired or was already used. Start again from Settings.' };
    expect(redirectParams(await callback(james, 'google', { code: 'c', state: 'made-up' }))).toEqual(expired);

    // A sign-in can only be finished by the user who started it, once, within ten minutes.
    const state = (client: ApiClient) => client('POST', '/api/integrations/oauth/google/start').then((r) => new URL(r.json().url).searchParams.get('state')!);
    const priyas = await state(priya);
    expect(redirectParams(await callback(james, 'google', { code: 'code-2', state: priyas }))).toEqual({
      integrationError: 'This sign-in was started by another user. Start again from Settings.',
    });
    expect(redirectParams(await callback(priya, 'google', { code: 'code-2', state: priyas }))).toEqual(expired);
    const old = await state(james);
    await s.db.run('UPDATE oauth_states SET created_at = ?', [new Date(Date.now() - 11 * 60_000).toISOString()]);
    expect(redirectParams(await callback(james, 'google', { code: 'code-2', state: old }))).toEqual(expired);

    expect((await james('POST', '/api/integrations/oauth/yahoo/start')).statusCode).toBe(404);
  });

  it('revokes the grant when the account is removed and keeps what was logged', async () => {
    expect((await james('DELETE', `/api/integrations/accounts/${accountId}`)).json()).toEqual({ ok: true });
    const revoke = http.find('POST', /oauth2\.googleapis\.com\/revoke$/).at(-1)!;
    expect(new URLSearchParams(revoke.body).get('token')).toBe('g-refresh-2');
    expect((await james('GET', '/api/integrations/accounts')).json()).toEqual([]);
    // Calendar events stay known, so connecting the calendar again does not log them twice.
    expect(await s.db.get('SELECT account_id FROM calendar_events WHERE external_id = ?', ['ge1@google.com'])).toEqual({ account_id: null });
    const items = await timeline(james, 'contact', ann);
    expect(emailItem(items, 'Contract')).toBeDefined();
    expect(items.find((i) => i.activityType === 'Meeting' && i.title === 'Pricing call (moved)')!.meeting!.calendar).toBeNull();
  });
});

describe('Microsoft accounts', () => {
  const ADDRESS = 'james.chen@contoso.example';
  const MS_SCOPE = ['openid', 'profile', 'email', 'User.Read', 'Mail.Read', 'Mail.Send', 'Calendars.ReadWrite'].map((s) => (/^[A-Z]/.test(s) ? `https://graph.microsoft.com/${s}` : s)).join(' ');
  const codes = new Map<string, Reply>();
  const refresh = new Map<string, Reply>();
  const people = new Map<string, Reply>();
  const delta = new Map<string, Reply>();
  const raws = new Map<string, Buffer>();
  let events: Record<string, unknown>[] = [];
  let eventIds = 0;
  let accountId: string;
  const reviewStart = at(-2 * DAY);
  const tradeShow = at(5 * DAY).toISOString().slice(0, 10);

  const deltaLink = (folder: string, token: string, kind = '$deltatoken') => `${GRAPH}/me/mailFolders/${folder}/messages/delta?${kind}=${token}`;
  const graphTime = (d: Date) => ({ dateTime: `${d.toISOString().slice(0, 19)}.0000000`, timeZone: 'UTC' });

  /** A message as Graph lists it in a delta page (its MIME source is served by `$value`). */
  function graphMessage(id: string, m: Parameters<typeof rfc822>[0], extra: object = {}) {
    raws.set(id, rfc822(m));
    const address = (value: string) => {
      const match = /^(.*)<([^>]+)>$/.exec(value.trim());
      return { emailAddress: match ? { name: match[1]!.trim(), address: match[2]! } : { address: value.trim() } };
    };
    return { id, internetMessageId: m.messageId, isDraft: false, from: address(m.from), toRecipients: m.to.split(',').map(address), ccRecipients: [], ...extra };
  }

  beforeAll(() => {
    http
      .on('POST', MS_TOKEN, tokenEndpoint(codes, refresh))
      .on('GET', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me$/, (req) =>
        answer(people.get(bearer(req)), () => Response.json({ error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } }, { status: 401 })),
      )
      .on('GET', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/mailFolders\/[^/]+\/messages\/delta$/, (req) => {
        const folder = req.url.pathname.split('/').at(-3);
        const token = req.url.searchParams.get('$deltatoken') ?? req.url.searchParams.get('$skiptoken') ?? 'initial';
        return answer(delta.get(`${folder}:${token}`), () => Response.json({ error: { code: 'syncStateNotFound', message: 'The sync state was not found.' } }, { status: 410 }));
      })
      .on('GET', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/messages\/[^/]+\/\$value$/, (req) => {
        const raw = raws.get(decodeURIComponent(req.url.pathname.split('/').at(-2)!));
        return raw
          ? new Response(new Uint8Array(raw), { headers: { 'content-type': 'message/rfc822' } })
          : Response.json({ error: { code: 'ErrorItemNotFound', message: 'The specified object was not found in the store.' } }, { status: 404 });
      })
      .on('POST', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/sendMail$/, () => new Response(null, { status: 202 }))
      .on('GET', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/calendarView$/, () => ({ value: events }))
      .on('POST', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events$/, (req) => {
        eventIds++;
        return { id: `AAMk-${eventIds}`, iCalUId: `040000008200E000-${eventIds}`, ...JSON.parse(req.body) };
      })
      .on('PATCH', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events\/[^/]+$/, (req) => JSON.parse(req.body))
      .on('DELETE', /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events\/[^/]+$/, () => new Response(null, { status: 204 }));
  });

  it('connects, then follows the delta of Inbox and Sent Items and logs meetings', async () => {
    const order = graphMessage('A1', { from: 'Ann Customer <ann@customer.example>', to: ADDRESS, subject: 'Order 1001', messageId: '<ms-a@customer.example>' });
    const draft = graphMessage('D1', { from: ADDRESS, to: 'ann@customer.example', subject: 'Draft reply', messageId: '<ms-draft@contoso.example>' }, { isDraft: true });
    const confirmed = graphMessage('S1', { from: `James Chen <${ADDRESS}>`, to: 'Ann Customer <ann@customer.example>', subject: 'Order 1001 confirmed', messageId: '<ms-s@contoso.example>' });
    delta.set('inbox:initial', { value: [order], '@odata.nextLink': deltaLink('inbox', 'p2', '$skiptoken') });
    delta.set('inbox:p2', { value: [{ id: 'X1', '@removed': { reason: 'deleted' } }, draft], '@odata.deltaLink': deltaLink('inbox', 'd1') });
    delta.set('sentitems:initial', { value: [confirmed], '@odata.deltaLink': deltaLink('sentitems', 's1') });
    const dayAfter = new Date(Date.parse(`${tradeShow}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
    events = [
      {
        id: 'AAMk-review',
        iCalUId: 'review-1',
        subject: 'Quarterly review',
        isAllDay: false,
        isCancelled: false,
        start: graphTime(reviewStart),
        end: graphTime(new Date(reviewStart.getTime() + HOUR)),
        location: { displayName: 'Teams' },
        body: { contentType: 'text', content: 'Agenda: numbers\r\n' },
        organizer: { emailAddress: { name: 'Ann Customer', address: 'ann@customer.example' } },
        attendees: [
          { type: 'required', emailAddress: { address: ADDRESS } },
          { type: 'resource', emailAddress: { address: 'room-1@contoso.example' } },
        ],
        responseStatus: { response: 'accepted' },
      },
      {
        id: 'AAMk-trade',
        iCalUId: 'trade-1',
        subject: 'Trade show',
        isAllDay: true,
        start: { dateTime: `${tradeShow}T00:00:00.0000000`, timeZone: 'UTC' },
        end: { dateTime: `${dayAfter}T00:00:00.0000000`, timeZone: 'UTC' },
        organizer: { emailAddress: { address: ADDRESS } },
        attendees: [{ type: 'optional', emailAddress: { address: 'Ann@Customer.example' } }],
        responseStatus: { response: 'organizer' },
      },
    ];
    codes.set('ms-code-1', { token_type: 'Bearer', scope: MS_SCOPE, expires_in: 4775, access_token: 'ms-access-1', refresh_token: 'ms-refresh-1' });
    people.set('ms-access-1', { displayName: 'James Chen', mail: null, userPrincipalName: 'James.Chen@Contoso.example' });

    const { authorize, outcome } = await connect(james, 'microsoft', 'ms-code-1');
    expect(authorize.origin + authorize.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: 'microsoft-client',
      redirect_uri: 'https://crm.example.com/api/integrations/oauth/microsoft/callback',
      response_type: 'code',
      scope: 'offline_access openid email profile User.Read Mail.Read Mail.Send Calendars.ReadWrite',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    expect(outcome).toEqual({ connected: ADDRESS });
    const token = Object.fromEntries(new URLSearchParams(http.find('POST', MS_TOKEN)[0]!.body));
    expect(token).toMatchObject({
      grant_type: 'authorization_code',
      code: 'ms-code-1',
      client_id: 'microsoft-client',
      client_secret: 'microsoft-secret',
      scope: 'offline_access openid email profile User.Read Mail.Read Mail.Send Calendars.ReadWrite',
    });
    expect(challengeOf(token.code_verifier!)).toBe(authorize.searchParams.get('code_challenge'));

    const accounts = (await james('GET', '/api/integrations/accounts')).json();
    expect(accounts).toHaveLength(1);
    accountId = accounts[0].id;
    expect(accounts[0]).toMatchObject({
      provider: 'microsoft',
      address: ADDRESS,
      status: 'active',
      lastError: null,
      capabilities: { sendEmail: true, syncEmail: true, calendar: true, exportEvents: true },
    });

    const first = http.find('GET', /inbox\/messages\/delta$/)[0]!;
    expect(first.headers.get('prefer')).toBe('odata.maxpagesize=50');
    expect(first.headers.get('authorization')).toBe('Bearer ms-access-1');
    expect(first.url.searchParams.get('$filter')).toMatch(/^receivedDateTime ge \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    // Removed items and drafts are not downloaded.
    expect(http.find('GET', /\$value$/).map((r) => r.url.pathname.split('/').at(-2))).toEqual(['A1', 'S1']);
    expect((await s.integrations.accounts.get(accountId))!.syncState.graph).toEqual({ inbox: deltaLink('inbox', 'd1'), sentitems: deltaLink('sentitems', 's1') });

    const items = await timeline(james, 'contact', ann);
    expect(emailItem(items, 'Order 1001')!.email).toMatchObject({ direction: 'inbound', provider: 'microsoft', from: 'ann@customer.example' });
    expect(emailItem(items, 'Order 1001 confirmed')!.email).toMatchObject({ direction: 'outbound', provider: 'microsoft', to: ['ann@customer.example'] });
    expect(emailItem(items, 'Draft reply')).toBeUndefined();

    expect(http.find('GET', /\/me\/calendarView$/)[0]!.headers.get('prefer')).toContain('outlook.timezone="UTC"');
    const review = items.find((i) => i.title === 'Quarterly review')!;
    expect(review.meeting).toEqual({
      start: reviewStart.toISOString(),
      end: new Date(reviewStart.getTime() + HOUR).toISOString(),
      location: 'Teams',
      attendees: ['ann@customer.example'],
      calendar: { provider: 'microsoft', direction: 'import' },
    });
    expect((await s.records.get(await principal(s, 'james'), 'activity', review.recordId!)).fields.description).toBe('Agenda: numbers');
    const trade = items.find((i) => i.title === 'Trade show')!;
    expect(trade).toMatchObject({ status: 'Open', meeting: { start: null, end: null, attendees: ['ann@customer.example'] } });
    expect((await s.records.get(await principal(s, 'james'), 'activity', trade.recordId!)).fields.due_date).toBe(tradeShow);
  });

  it('starts the delta again from shortly before the last sync when Graph expires it', async () => {
    const { mailSyncedAt } = (await s.integrations.accounts.get(accountId))!.syncState;
    const order = graphMessage('A1', { from: 'Ann Customer <ann@customer.example>', to: ADDRESS, subject: 'Order 1001', messageId: '<ms-a@customer.example>' });
    const second = graphMessage('B1', { from: 'Ann Customer <ann@customer.example>', to: ADDRESS, subject: 'Order 1002', messageId: '<ms-b@customer.example>' });
    delta.set('inbox:d1', () => Response.json({ error: { code: 'syncStateNotFound', message: 'The sync state generation is not found.' } }, { status: 410 }));
    delta.set('inbox:initial', { value: [order, second], '@odata.deltaLink': deltaLink('inbox', 'd2') });
    delta.set('sentitems:s1', { value: [], '@odata.deltaLink': deltaLink('sentitems', 's2') });

    const { result } = await sync(james, accountId);
    expect(result).toEqual({ mail: { logged: 1, duplicates: 1, skipped: 0 }, calendar: { imported: 0, updated: 0, skipped: 2 }, error: null });
    const restart = http.find('GET', /inbox\/messages\/delta$/).filter((r) => !r.url.search.includes('token')).at(-1)!;
    expect(restart.url.searchParams.get('$filter')).toBe(`receivedDateTime ge ${new Date(Date.parse(mailSyncedAt!) - HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z')}`);
    expect(emailItem(await timeline(james, 'contact', ann), 'Order 1002')).toBeDefined();
  });

  it('sends complete MIME messages through Graph', async () => {
    const res = await james('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Order 1002 shipped', body: 'On its way.' });
    expect(res.json()).toMatchObject({ status: 'sent', via: 'account', from: ADDRESS });
    const sent = http.find('POST', /\/me\/sendMail$/).at(-1)!;
    expect(sent.headers.get('content-type')).toBe('text/plain');
    expect(sent.headers.get('authorization')).toBe('Bearer ms-access-1');
    const parsed = await PostalMime.parse(Buffer.from(sent.body, 'base64'));
    expect(parsed.from).toMatchObject({ name: 'James Chen', address: ADDRESS });
    expect(parsed.subject).toBe('Order 1002 shipped');
    expect(await s.db.get('SELECT message_id, provider FROM email_messages WHERE subject = ?', ['Order 1002 shipped'])).toEqual({
      message_id: parsed.messageId,
      provider: 'microsoft',
    });

    // Graph saves a copy in Sent Items, which sync recognizes.
    delta.set('inbox:d2', { value: [], '@odata.deltaLink': deltaLink('inbox', 'd3') });
    delta.set('sentitems:s2', {
      value: [graphMessage('S2', { from: ADDRESS, to: 'ann@customer.example', subject: 'Order 1002 shipped', messageId: parsed.messageId! })],
      '@odata.deltaLink': deltaLink('sentitems', 's3'),
    });
    expect((await sync(james, accountId)).result.mail).toEqual({ logged: 0, duplicates: 1, skipped: 0 });

    const sends = http.find('POST', /\/me\/sendMail$/).length;
    const megabyte = Buffer.alloc(1024 * 1024, 7).toString('base64');
    const big = await james('POST', '/api/email/send', {
      recordId: ann,
      to: ['ann@customer.example'],
      subject: 'Catalog',
      body: 'Three parts.',
      files: [1, 2, 3].map((n) => ({ fileName: `part${n}.bin`, data: megabyte })),
    });
    expect([big.statusCode, big.json().error.message]).toEqual([400, 'Emails sent through a Microsoft account can be at most about 3 MB including attachments']);
    expect(http.find('POST', /\/me\/sendMail$/)).toHaveLength(sends);

    const other = await priya('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Hi', body: 'x', accountId });
    expect([other.statusCode, other.json().error.message]).toEqual([404, 'Account not found']);
  });

  it('stores the new refresh token Microsoft returns on refresh', async () => {
    await expireToken(accountId);
    refresh.set('ms-refresh-1', { access_token: 'ms-access-2', refresh_token: 'ms-refresh-2', expires_in: 3600, scope: 'Calendars.ReadWrite Mail.Read Mail.Send User.Read openid profile email' });
    expect(await s.integrations.accounts.accessToken((await s.integrations.accounts.get(accountId))!)).toBe('ms-access-2');
    expect(Object.fromEntries(new URLSearchParams(http.find('POST', MS_TOKEN).at(-1)!.body))).toEqual({
      client_id: 'microsoft-client',
      client_secret: 'microsoft-secret',
      grant_type: 'refresh_token',
      refresh_token: 'ms-refresh-1',
      scope: 'offline_access openid email profile User.Read Mail.Read Mail.Send Calendars.ReadWrite',
    });
    expect(await credentials(accountId)).toMatchObject({ accessToken: 'ms-access-2', refreshToken: 'ms-refresh-2' });
    // Scopes without the resource prefix mean the same permissions.
    expect((await james('GET', '/api/integrations/accounts')).json()[0].capabilities).toEqual({ sendEmail: true, syncEmail: true, calendar: true, exportEvents: true });
  });

  it('shows the first line of an expired sign-in and recovers when the user connects again', async () => {
    await expireToken(accountId);
    refresh.set('ms-refresh-2', () =>
      Response.json(
        {
          error: 'invalid_grant',
          error_description: 'AADSTS700082: The refresh token has expired due to inactivity.\r\nTrace ID: 0000\r\nCorrelation ID: 1111\r\nTimestamp: 2026-11-22 10:00:00Z',
          error_codes: [700082],
        },
        { status: 400 },
      ),
    );
    const { result, account } = await sync(james, accountId);
    const error = 'Email: Reconnect required: Microsoft no longer accepts the stored sign-in (AADSTS700082: The refresh token has expired due to inactivity.)';
    expect(result).toEqual({ mail: null, calendar: null, error });
    expect(account).toMatchObject({ status: 'error', lastError: error });

    delta.set('inbox:d3', { value: [], '@odata.deltaLink': deltaLink('inbox', 'd3') });
    delta.set('sentitems:s3', { value: [], '@odata.deltaLink': deltaLink('sentitems', 's3') });
    codes.set('ms-code-2', { token_type: 'Bearer', scope: MS_SCOPE, expires_in: 3600, access_token: 'ms-access-3', refresh_token: 'ms-refresh-3' });
    people.set('ms-access-3', { displayName: 'James Chen', mail: 'James.Chen@contoso.example', userPrincipalName: 'jchen@contoso.example' });
    expect((await connect(james, 'microsoft', 'ms-code-2')).outcome).toEqual({ connected: ADDRESS });
    expect((await james('GET', '/api/integrations/accounts')).json()).toMatchObject([{ id: accountId, status: 'active', lastError: null }]);
  });

  it('only invites attendees from Outlook when asked to', async () => {
    const start = at(3 * DAY);
    const end = new Date(start.getTime() + HOUR);
    const meeting = { recordId: ann, subject: 'Site visit', start: start.toISOString(), end: end.toISOString(), location: 'Plant 2', attendees: ['ann@customer.example'], accountId };
    const quiet = await james('POST', '/api/meetings', meeting);
    expect(quiet.json()).toMatchObject({ calendar: { accountId, provider: 'microsoft' }, calendarError: null });
    expect(JSON.parse(http.find('POST', /\/me\/events$/).at(-1)!.body)).toEqual({
      subject: 'Site visit',
      body: { contentType: 'text', content: '' },
      start: { dateTime: start.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
      end: { dateTime: end.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
      location: { displayName: 'Plant 2' },
    });

    const invited = await james('POST', '/api/meetings', { ...meeting, sendInvites: true });
    expect(JSON.parse(http.find('POST', /\/me\/events$/).at(-1)!.body).attendees).toEqual([{ emailAddress: { address: 'ann@customer.example' }, type: 'required' }]);

    await s.records.delete(await principal(s, 'james'), 'activity', invited.json().activityId);
    await s.jobs.drain();
    expect(http.find('DELETE', /\/me\/events\/[^/]+$/).at(-1)!.url.pathname).toBe(`/v1.0/me/events/AAMk-${eventIds}`);
  });

  it('removes the account without calling a revoke endpoint', async () => {
    const revokes = http.requests.filter((r) => /revoke/.test(r.url.pathname)).length;
    expect((await james('DELETE', `/api/integrations/accounts/${accountId}`)).json()).toEqual({ ok: true });
    expect(http.requests.filter((r) => /revoke/.test(r.url.pathname))).toHaveLength(revokes);
    expect((await james('GET', '/api/integrations/status')).json().email).toEqual({ mode: 'relay', accountId: null, from: 'crm@titoforce.example' });
  });
});

describe('without Google and Microsoft configuration', () => {
  it('does not offer the sign-ins', async () => {
    const other = new FakeHttp();
    const s2 = await createTestServices({ fetchImpl: other.fetch });
    const app2 = await buildApp(s2);
    try {
      const user = await signIn(app2, 'james');
      expect((await user('GET', '/api/integrations/status')).json().oauth).toEqual({ google: false, microsoft: false });
      const google = await user('POST', '/api/integrations/oauth/google/start');
      expect([google.statusCode, google.json().error.message]).toEqual([400, 'Google accounts are not configured on this server']);
      expect((await user('POST', '/api/integrations/oauth/microsoft/start')).json().error.message).toBe('Microsoft accounts are not configured on this server');
      expect(other.requests).toEqual([]);
    } finally {
      await app2.close();
      await s2.close();
    }
  });
});

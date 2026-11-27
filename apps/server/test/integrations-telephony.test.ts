import type { TimelineItem } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { twilioSignature } from '../src/integrations/telephony.ts';
import type { Services } from '../src/services.ts';
import { createTestServices, demoUser, principal } from './helpers.ts';
import { type ApiClient, b64, FakeHttp, INTEGRATION_ENV, signIn, twilioPost } from './integration-fakes.ts';

const CALLS = /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC123\/Calls\.json$/;
const BASE = 'https://crm.example.com';
const JAMES_PHONE = '+16285550100';
const ANN_PHONE = '+14155550123';

const http = new FakeHttp();
let s: Services;
let app: FastifyInstance;
let james: ApiClient;
let priya: ApiClient;
let ann: string;
let sids = 0;
let twilioRefuses: string | null = null;
/** The completed click-to-call, for the access checks. */
let connected: { id: string; activityId: string };
let unanswered: string;

beforeAll(async () => {
  http.on('POST', CALLS, () =>
    twilioRefuses
      ? Response.json({ code: 21215, message: twilioRefuses, more_info: 'https://www.twilio.com/docs/errors/21215', status: 400 }, { status: 400 })
      : Response.json({ sid: `CA${++sids}`, status: 'queued' }, { status: 201 }),
  );
  s = await createTestServices({ env: INTEGRATION_ENV, fetchImpl: http.fetch });
  app = await buildApp(s);
  james = await signIn(app, 'james');
  priya = await signIn(app, 'priya');
  ann = (await s.records.create(await principal(s, 'james'), 'contact', { first_name: 'Ann', last_name: 'Customer', email: 'ann@customer.example', mobile: '(415) 555-0123' })).id;
});
afterAll(async () => {
  await app?.close();
  await s?.close();
});

const errorOf = (res: { statusCode: number; json(): { error?: { message?: string } } }) => [res.statusCode, res.json().error?.message];

/** An attribute of the first `tag` element of a TwiML document, unescaped. */
function attr(twiml: string, tag: string, name: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(twiml);
  if (!m) throw new Error(`No ${name} on <${tag}> in ${twiml}`);
  return m[1]!.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
const dialed = (twiml: string) => /<Number\b[^>]*>([^<]+)<\/Number>/.exec(twiml)?.[1];
/** Twilio posts to the absolute URLs titoForce gave it; the app is reached by path. */
const post = (url: string, form: Record<string, string>) => twilioPost(app, url.replace(BASE, ''), form);
const callOf = async (client: ApiClient, id: string) => (await client('GET', `/api/calls/${id}`)).json();

async function timeline(id: string): Promise<TimelineItem[]> {
  const res = await james('GET', `/api/records/contact/${id}/timeline`);
  expect(res.statusCode).toBe(200);
  return res.json().items;
}

async function notifications(key: string) {
  return (await (await signIn(app, key))('GET', '/api/notifications')).json().items as { title: string; body: string | null; link: string | null }[];
}

describe('phone numbers of users', () => {
  it('saves the number titoForce rings and keeps it from other users', async () => {
    expect((await james('GET', '/api/integrations/status')).json().telephony).toEqual({ twilio: true, phone: null, ready: false, number: '+14155550000' });
    expect(errorOf(await james('POST', '/api/calls', { recordId: ann, phone: ANN_PHONE }))).toEqual([
      400,
      'Add your phone number in Settings first: titoForce rings your phone, then connects the call.',
    ]);
    expect(errorOf(await james('PUT', '/api/integrations/phone', { phone: 'call me maybe' }))).toEqual([400, 'Enter your number in international format, e.g. +1 415 555 0100']);

    // National numbers get the server's default calling code.
    expect((await james('PUT', '/api/integrations/phone', { phone: '(628) 555-0100' })).json().phone).toBe(JAMES_PHONE);
    expect((await james('GET', '/api/integrations/status')).json().telephony).toEqual({ twilio: true, phone: JAMES_PHONE, ready: true, number: '+14155550000' });

    const jamesIn = async (client: ApiClient) => (await client('GET', '/api/users')).json().find((u: { email: string }) => u.email === 'james@titoforce.example');
    expect(await jamesIn(priya)).not.toHaveProperty('phone');
    expect((await jamesIn(james)).phone).toBe(JAMES_PHONE);
    expect((await jamesIn(await signIn(app, 'admin'))).phone).toBe(JAMES_PHONE);
  });
});

describe('click-to-call', () => {
  it('rings the user, waits for them to press 1, then connects and logs the call', async () => {
    const res = await james('POST', '/api/calls', { recordId: ann, phone: '(415) 555-0123' });
    expect(res.statusCode).toBe(201);
    const { call } = res.json();
    expect(res.json().activityId).toBeNull();
    expect(call).toMatchObject({ direction: 'outbound', status: 'queued', provider: 'twilio', from: '+14155550000', to: ANN_PHONE, durationSeconds: null });

    const create = http.find('POST', CALLS).at(-1)!;
    expect(create.headers.get('authorization')).toBe(`Basic ${b64('AC123:twilio-token')}`);
    expect(Object.fromEntries(new URLSearchParams(create.body))).toEqual({
      To: JAMES_PHONE,
      From: '+14155550000',
      Url: `${BASE}/api/telephony/twilio/bridge?call=${call.id}`,
      StatusCallback: `${BASE}/api/telephony/twilio/status?call=${call.id}`,
    });

    // The user's phone was answered, possibly by their voicemail: nothing is dialed or logged before they press 1.
    const bridge = `${BASE}/api/telephony/twilio/bridge?call=${call.id}`;
    const gather = await post(bridge, { CallSid: 'CA1', CallStatus: 'in-progress' });
    expect(gather.headers['content-type']).toBe('text/xml; charset=utf-8');
    expect(gather.body).toContain('<Say>Press 1 to connect your call.</Say>');
    expect(attr(gather.body, 'Gather', 'action')).toBe(bridge);
    expect(await callOf(james, call.id)).toMatchObject({ call: { status: 'queued' }, activityId: null });

    const dial = await post(bridge, { CallSid: 'CA1', CallStatus: 'in-progress', Digits: '1' });
    expect(dialed(dial.body)).toBe(ANN_PHONE);
    expect(attr(dial.body, 'Dial', 'callerId')).toBe('+14155550000');
    expect(attr(dial.body, 'Number', 'statusCallbackEvent')).toBe('answered completed');
    const legStatus = attr(dial.body, 'Number', 'statusCallback');
    expect(legStatus).toBe(`${BASE}/api/telephony/twilio/status?call=${call.id}&leg=dialed`);
    // Pressing 1 again does not dial a second time.
    expect((await post(bridge, { CallSid: 'CA1', Digits: '1' })).body).toContain('<Hangup/>');

    const ringing = await callOf(james, call.id);
    expect(ringing.call.status).toBe('ringing');
    const activity = await s.records.get(await principal(s, 'james'), 'activity', ringing.activityId);
    expect(activity.fields).toMatchObject({ subject: 'Call to Ann Customer', type: 'Call', status: 'Open', related_to: ann });

    await post(legStatus, { CallSid: 'CA1-leg', ParentCallSid: 'CA1', CallStatus: 'in-progress' });
    expect((await callOf(james, call.id)).call.status).toBe('in-progress');
    await post(legStatus, { CallSid: 'CA1-leg', ParentCallSid: 'CA1', CallStatus: 'completed', CallDuration: '42' });
    // The <Dial> action and the end of the whole call arrive afterwards and change nothing.
    expect((await post(attr(dial.body, 'Dial', 'action'), { CallSid: 'CA1', DialCallStatus: 'completed', DialCallDuration: '41' })).body).toContain('<Hangup/>');
    await post(`${BASE}/api/telephony/twilio/status?call=${call.id}`, { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '60' });

    const item = (await timeline(ann)).find((i) => i.recordId === ringing.activityId)!;
    expect(item).toMatchObject({ title: 'Call to Ann Customer', status: 'Completed' });
    expect(item.call).toMatchObject({ id: call.id, direction: 'outbound', status: 'completed', provider: 'twilio', from: '+14155550000', to: ANN_PHONE, durationSeconds: 42, outcome: 'Connected' });
    expect(item.call!.endedAt).not.toBeNull();
    connected = { id: call.id, activityId: ringing.activityId };
  });

  it('ends calls that were not connected', async () => {
    const start = async () => (await james('POST', '/api/calls', { recordId: ann, phone: ANN_PHONE })).json().call.id as string;

    // The user hung up (or their voicemail did) without pressing 1.
    unanswered = await start();
    await post(`${BASE}/api/telephony/twilio/status?call=${unanswered}`, { CallSid: 'x', CallStatus: 'completed', CallDuration: '8' });
    expect(await callOf(james, unanswered)).toMatchObject({ call: { status: 'canceled', durationSeconds: null, outcome: null }, activityId: null });

    const missed = await start();
    await post(`${BASE}/api/telephony/twilio/status?call=${missed}`, { CallSid: 'x', CallStatus: 'no-answer' });
    expect(await callOf(james, missed)).toMatchObject({ call: { status: 'no-answer' }, activityId: null });

    // The customer's line was busy: the call is logged and completed with the outcome.
    const busy = await start();
    const dial = await post(`${BASE}/api/telephony/twilio/bridge?call=${busy}`, { CallSid: 'x', Digits: '1' });
    expect((await post(attr(dial.body, 'Dial', 'action'), { CallSid: 'x', DialCallStatus: 'busy' })).body).toContain('<Hangup/>');
    const state = await callOf(james, busy);
    expect(state.call).toMatchObject({ status: 'busy', outcome: 'Busy', durationSeconds: null });
    expect((await s.records.get(await principal(s, 'james'), 'activity', state.activityId)).fields.status).toBe('Completed');
  });

  it('checks the number and reports what Twilio refused', async () => {
    for (const [patch, status, message] of [
      [{ phone: 'not a number' }, 400, '"not a number" cannot be dialed. Write it in international format, e.g. +44 20 7946 0958.'],
      [{ phone: '+1 628 555 0100' }, 400, 'This is your own phone number'],
      [{ recordId: 'con_missing' }, 404, 'Record not found'],
    ] as const) {
      expect(errorOf(await james('POST', '/api/calls', { recordId: ann, phone: ANN_PHONE, ...patch }))).toEqual([status, message]);
    }
    twilioRefuses = 'Account not authorized to call +442079460958.';
    try {
      expect(errorOf(await james('POST', '/api/calls', { recordId: ann, phone: '+44 20 7946 0958' }))).toEqual([502, 'Twilio returned HTTP 400: Account not authorized to call +442079460958.']);
    } finally {
      twilioRefuses = null;
    }
    expect(await s.db.all('SELECT id FROM calls WHERE to_number = ?', ['+442079460958'])).toEqual([]);
  });
});

describe('calls to the Twilio number', () => {
  const voice = (form: Record<string, string>) => post(`${BASE}/api/telephony/twilio/voice`, { To: '+14155550000', CallStatus: 'ringing', ...form });
  const callIdOf = (twiml: string) => new URL(attr(twiml, 'Dial', 'action')).searchParams.get('call')!;

  it("forwards the call to the phone of the caller's record owner", async () => {
    const res = await voice({ CallSid: 'CA100', From: ANN_PHONE });
    expect(dialed(res.body)).toBe(JAMES_PHONE);
    expect(attr(res.body, 'Dial', 'answerOnBridge')).toBe('true');
    // The user sees who is calling.
    expect(res.body).not.toContain('callerId');
    const id = callIdOf(res.body);
    // Twilio may post the same call again.
    expect(callIdOf((await voice({ CallSid: 'CA100', From: ANN_PHONE })).body)).toBe(id);
    expect(await s.db.all('SELECT id FROM calls WHERE provider_call_id = ?', ['CA100'])).toEqual([{ id }]);

    const ringing = await callOf(james, id);
    expect(ringing.call).toMatchObject({ direction: 'inbound', status: 'ringing', from: ANN_PHONE, to: '+14155550000' });
    await post(attr(res.body, 'Number', 'statusCallback'), { CallSid: 'CA101', ParentCallSid: 'CA100', CallStatus: 'in-progress' });
    expect((await post(attr(res.body, 'Dial', 'action'), { CallSid: 'CA100', DialCallStatus: 'completed', DialCallDuration: '95' })).body).toContain('<Hangup/>');
    await post(attr(res.body, 'Number', 'statusCallback'), { CallSid: 'CA101', ParentCallSid: 'CA100', CallStatus: 'completed', CallDuration: '96' });

    const item = (await timeline(ann)).find((i) => i.recordId === ringing.activityId)!;
    expect(item).toMatchObject({ title: 'Call from Ann Customer', status: 'Completed' });
    expect(item.call).toMatchObject({ direction: 'inbound', status: 'completed', durationSeconds: 95, outcome: 'Connected' });
  });

  it('logs missed calls as call-back reminders and tells the user', async () => {
    const res = await voice({ CallSid: 'CA110', From: ANN_PHONE });
    const id = callIdOf(res.body);
    const unavailable = await post(attr(res.body, 'Dial', 'action'), { CallSid: 'CA110', DialCallStatus: 'no-answer' });
    expect(unavailable.body).toContain('<Say>Sorry, no one can take your call right now.');
    const state = await callOf(james, id);
    expect(state.call).toMatchObject({ status: 'no-answer', outcome: 'No answer' });
    expect((await s.records.get(await principal(s, 'james'), 'activity', state.activityId)).fields).toMatchObject({ subject: 'Missed call from Ann Customer', status: 'Open' });
    expect((await notifications('james'))[0]).toEqual(expect.objectContaining({ title: 'Missed call from Ann Customer', body: ANN_PHONE, link: `/r/${state.activityId}` }));

    // Unknown and hidden numbers go to the default owner (the first administrator), who has no phone number here.
    for (const [from, name] of [
      ['+44 20 7946 0958', '+442079460958'],
      ['anonymous', 'an unknown number'],
    ]) {
      const twiml = (await voice({ CallSid: `CA-${name}`, From: from })).body;
      expect(twiml).toContain('<Say>Sorry, no one can take your call right now.');
      expect(twiml).not.toContain('<Dial');
      const [row] = await s.db.all<{ user_id: string; activity_id: string; status: string }>('SELECT user_id, activity_id, status FROM calls WHERE provider_call_id = ?', [`CA-${name}`]);
      expect(row).toMatchObject({ user_id: (await demoUser(s, 'admin')).id, status: 'no-answer' });
      const fields = (await s.records.get(await principal(s, 'admin'), 'activity', row!.activity_id)).fields;
      expect(fields.subject).toBe(`Missed call from ${name}`);
      expect(fields.related_to ?? null).toBeNull();
      expect((await notifications('admin'))[0]!.title).toBe(`Missed call from ${name}`);
    }
  });

  it('accepts only requests signed with the Twilio auth token', async () => {
    const form = { CallSid: 'CA200', From: ANN_PHONE, To: '+14155550000' };
    const url = `${BASE}/api/telephony/twilio/voice`;
    for (const signature of [null, twilioSignature('another-token', url, form), twilioSignature('twilio-token', url, { ...form, From: '+15005550006' })]) {
      expect(errorOf(await twilioPost(app, '/api/telephony/twilio/voice', form, signature))).toEqual([403, 'The request signature is not valid']);
    }
    // Signed for another call.
    const other = twilioSignature('twilio-token', `${BASE}/api/telephony/twilio/status?call=${unanswered}x`, { CallStatus: 'completed' });
    expect((await twilioPost(app, `/api/telephony/twilio/status?call=${unanswered}`, { CallStatus: 'completed' }, other)).statusCode).toBe(403);
    expect(await s.db.all('SELECT id FROM calls WHERE provider_call_id = ?', ['CA200'])).toEqual([]);

    // Twilio may sign the URL with the default port.
    const withPort = twilioSignature('twilio-token', 'https://crm.example.com:443/api/telephony/twilio/voice', form);
    expect((await twilioPost(app, '/api/telephony/twilio/voice', form, withPort)).statusCode).toBe(200);
    expect(await s.db.all('SELECT id FROM calls WHERE provider_call_id = ?', ['CA200'])).toHaveLength(1);
  });
});

describe('calls logged by hand', () => {
  it('logs a call with its outcome, duration and notes', async () => {
    const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const res = await james('POST', '/api/calls/log', { recordId: ann, direction: 'outbound', outcome: 'Left voicemail', durationSeconds: 30, notes: 'Line 1\r\nLine 2', phone: ' +1 415 555 0123 ', at });
    expect(res.statusCode).toBe(201);
    expect(res.json().call).toMatchObject({
      direction: 'outbound',
      status: 'logged',
      provider: 'manual',
      from: null,
      to: '+1 415 555 0123',
      durationSeconds: 30,
      outcome: 'Left voicemail',
      startedAt: at,
      endedAt: new Date(Date.parse(at) + 30_000).toISOString(),
    });
    const item = (await timeline(ann)).find((i) => i.recordId === res.json().activityId)!;
    expect(item).toMatchObject({ title: 'Call to Ann Customer', status: 'Completed', at, body: 'Line 1\nLine 2', call: { outcome: 'Left voicemail' } });

    const inbound = await james('POST', '/api/calls/log', { recordId: ann, direction: 'inbound', subject: '  Pricing   question ', phone: ANN_PHONE });
    expect(inbound.json().call).toMatchObject({ direction: 'inbound', from: ANN_PHONE, to: null, durationSeconds: null, endedAt: null });
    expect((await s.records.get(await principal(s, 'james'), 'activity', inbound.json().activityId)).name).toBe('Pricing question');

    const noah = await signIn(app, 'noah');
    for (const [client, patch, status, message] of [
      [james, { at: new Date(Date.now() + 3_600_000).toISOString() }, 400, 'A logged call cannot be in the future'],
      [james, { at: 'yesterday' }, 400, '"at" is not a valid date and time'],
      [noah, {}, 404, 'Record not found'],
    ] as const) {
      expect(errorOf(await client('POST', '/api/calls/log', { recordId: ann, direction: 'outbound', ...patch })), message).toEqual([status, message]);
    }
  });

  it('shows a call only to users who can see its activity', async () => {
    expect((await callOf(priya, connected.id)).activityId).toBe(connected.activityId);
    expect(errorOf(await (await signIn(app, 'noah'))('GET', `/api/calls/${connected.id}`))).toEqual([404, 'Record not found']);
    // Calls that were never logged are only visible to the caller.
    expect(errorOf(await priya('GET', `/api/calls/${unanswered}`))).toEqual([404, 'Call not found']);
  });
});

describe('without Twilio', () => {
  it('logs calls by hand and ignores webhooks', async () => {
    const plain = await createTestServices({ env: { TITO_PUBLIC_URL: BASE } });
    const plainApp = await buildApp(plain);
    try {
      const client = await signIn(plainApp, 'james');
      const contact = (await plain.records.create(await principal(plain, 'james'), 'contact', { last_name: 'Customer' })).id;
      expect((await client('GET', '/api/integrations/status')).json().telephony).toMatchObject({ twilio: false, ready: false, number: null });
      expect(errorOf(await client('POST', '/api/calls', { recordId: contact, phone: ANN_PHONE }))).toEqual([400, 'Calling is not set up: an administrator has to configure Twilio.']);
      expect((await client('POST', '/api/calls/log', { recordId: contact, direction: 'outbound' })).statusCode).toBe(201);
      expect((await twilioPost(plainApp, '/api/telephony/twilio/voice', { CallSid: 'CA1', From: ANN_PHONE })).statusCode).toBe(404);
    } finally {
      await plainApp.close();
      await plain.close();
    }
  });
});

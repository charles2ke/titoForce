import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { buildIcsFeed, parseIcs } from '../src/integrations/ics.ts';
import { isPrivateAddress, parseFeedUrl } from '../src/integrations/net.ts';
import { toE164, twilioSignature } from '../src/integrations/telephony.ts';
import { normalizePhone } from '../src/platform/contact-points.ts';
import type { Services } from '../src/services.ts';
import { createTestServices, principal } from './helpers.ts';
import { b64, INTEGRATION_ENV, login } from './integration-fakes.ts';

let s: Services;
let app: FastifyInstance;
const cookie: Record<string, string> = {};
let contactId: string;

beforeAll(async () => {
  s = await createTestServices({ env: INTEGRATION_ENV });
  app = await buildApp(s);
  for (const key of ['james', 'priya', 'noah']) cookie[key] = await login(app, key);
  contactId = (await s.records.create(await principal(s, 'james'), 'contact', { first_name: 'Ann', last_name: 'Files', email: 'ann.files@customer.example' })).id;
});
afterAll(async () => {
  await app?.close();
  await s?.close();
});

const upload = (who: string, body: object, path = `contact/${contactId}`) =>
  app.inject({ method: 'POST', url: `/api/records/${path}/attachments`, headers: { cookie: cookie[who]! }, payload: body });
const download = (who: string, id: string) => app.inject({ url: `/api/attachments/${id}`, headers: { cookie: cookie[who]! } });

describe('file attachments', () => {
  it('stores uploads under a safe name and type and serves them as downloads', async () => {
    const res = await upload('james', { fileName: '../Résumé "final".pdf', contentType: 'application/pdf; charset=binary', data: b64('%PDF-1.4 hello') });
    expect(res.statusCode).toBe(201);
    const file = res.json();
    expect(file).toMatchObject({
      fileName: '_Résumé "final".pdf',
      contentType: 'application/pdf',
      size: 14,
      recordId: contactId,
      source: 'upload',
      createdByName: 'James Chen',
      activity: null,
    });
    const dl = await download('james', file.id);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="_R_sum_ _final_.pdf"; filename*=UTF-8''_R%C3%A9sum%C3%A9%20%22final%22.pdf`);
    expect(dl.headers['content-length']).toBe('14');
    expect(dl.body).toBe('%PDF-1.4 hello');
  });

  it('serves active content (HTML, SVG) as a plain download', async () => {
    const html = (await upload('james', { fileName: 'page.html', contentType: 'text/html', data: `data:text/html;base64,${b64('<script>alert(1)</script>')}` })).json();
    expect(html.contentType).toBe('text/html');
    expect((await download('james', html.id)).headers['content-type']).toBe('application/octet-stream');
    const svg = (await upload('james', { fileName: 'logo.svg', contentType: 'image/svg+xml', data: b64('<svg/>') })).json();
    expect((await download('james', svg.id)).headers['content-type']).toBe('application/octet-stream');
  });

  it('follows the access rules of the record', async () => {
    const file = (await upload('james', { fileName: 'notes.txt', contentType: 'text/plain', data: b64('notes') })).json();
    // Sales reps read every contact but edit only their own.
    expect((await download('priya', file.id)).statusCode).toBe(200);
    const denied = await upload('priya', { fileName: 'x.txt', data: b64('x') });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toBe('You cannot edit this contact record');
    expect((await app.inject({ method: 'DELETE', url: `/api/attachments/${file.id}`, headers: { cookie: cookie.priya! } })).statusCode).toBe(403);
    // Employees cannot see contacts at all, so their files do not exist for them.
    const hidden = await download('noah', file.id);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error.message).toBe('File not found');
    expect((await app.inject({ url: `/api/records/contact/${contactId}/attachments`, headers: { cookie: cookie.noah! } })).statusCode).toBe(404);
  });

  it('rejects data that is not a valid file', async () => {
    const cases: [string, string][] = [
      ['not base64!', 'The file data must be base64 encoded'],
      ['==', 'The file is empty'],
      [Buffer.alloc(1024 * 1024 + 10).toString('base64'), 'Files can be at most 1 MB'],
    ];
    for (const [data, message] of cases) {
      const res = await upload('james', { fileName: 'f.bin', data });
      expect(res.statusCode, message).toBe(400);
      expect(res.json().error.message).toBe(message);
    }
  });

  it('lists the files of a record and its activities, deletes them, and removes them with the record', async () => {
    const james = await principal(s, 'james');
    const contact = await s.records.create(james, 'contact', { first_name: 'Ben', last_name: 'Files', email: 'ben.files@customer.example' });
    const activity = await s.records.create(james, 'activity', { subject: 'Kickoff notes', type: 'Note', status: 'Completed', related_to: contact.id });
    const onContact = (await upload('james', { fileName: 'contract.pdf', contentType: 'application/pdf', data: b64('contract') }, `contact/${contact.id}`)).json();
    await new Promise((r) => setTimeout(r, 5));
    const onActivity = (await upload('james', { fileName: 'minutes.txt', contentType: 'text/plain', data: b64('minutes') }, `activity/${activity.id}`)).json();

    const list = async () => (await app.inject({ url: `/api/records/contact/${contact.id}/attachments`, headers: { cookie: cookie.james! } })).json();
    const files = await list();
    expect(files.map((f: { id: string }) => f.id)).toEqual([onActivity.id, onContact.id]);
    expect(files[0].activity).toEqual({ id: activity.id, name: activity.name });
    expect(files[1].activity).toBeNull();

    expect((await app.inject({ method: 'DELETE', url: `/api/attachments/${onActivity.id}`, headers: { cookie: cookie.james! } })).json()).toEqual({ ok: true });
    expect((await download('james', onActivity.id)).statusCode).toBe(404);
    expect((await list()).map((f: { id: string }) => f.id)).toEqual([onContact.id]);

    await s.records.delete(james, 'contact', contact.id);
    expect(await s.db.get('SELECT id FROM attachments WHERE id = ?', [onContact.id])).toBeUndefined();
    expect(await s.db.get('SELECT attachment_id FROM attachment_contents WHERE attachment_id = ?', [onContact.id])).toBeUndefined();
  });
});

describe('integration helpers', () => {
  it('writes phone numbers in E.164 and compares them by their last ten digits', () => {
    expect(toE164('+1 (415) 555-0100', null)).toBe('+14155550100');
    expect(toE164('0044 20 7946 0958', null)).toBe('+442079460958');
    expect(toE164('415-555-0100', '1')).toBe('+14155550100');
    expect(toE164('1 415 555 0100', '1')).toBe('+14155550100');
    expect(toE164('011 44 20 7946 0958', '1')).toBe('+442079460958');
    expect(toE164('020 7946 0958', '44')).toBe('+442079460958');
    expect(toE164('+1 415 555 0100 ext. 12', null)).toBe('+14155550100');
    expect(toE164('415-555-0100', null)).toBeNull();
    expect(toE164('1-800-FLOWERS', '1')).toBeNull();
    expect(normalizePhone('(415) 555-0100 x12')).toBe('4155550100');
    expect(normalizePhone('+1 415.555.0100')).toBe('4155550100');
    expect(normalizePhone('12345')).toBeNull();
  });

  it('computes the Twilio request signature', () => {
    // The example from Twilio's webhook security documentation.
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
    expect(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  });

  it('treats loopback, private, link-local and unparsable addresses as private', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '169.254.169.254', '100.64.0.1', '::1', '::ffff:192.168.1.1', 'fd00::1', '[fe80::1]', 'example.com']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '2001:4860:4860::8888', '::ffff:8.8.4.4']) expect(isPrivateAddress(a), a).toBe(false);
  });

  it('accepts http, https and webcal calendar URLs', () => {
    expect(parseFeedUrl(' webcal://cal.example.com/a.ics ').toString()).toBe('https://cal.example.com/a.ics');
    expect(parseFeedUrl('http://cal.example.com/a.ics').protocol).toBe('http:');
    expect(() => parseFeedUrl('ftp://cal.example.com/a.ics')).toThrow('Calendar URLs must start with https://, http:// or webcal://');
    expect(() => parseFeedUrl('not a url')).toThrow('Enter a valid calendar URL');
  });

  it('parses iCalendar files leniently, expanding recurring events', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:weekly@test',
      'DTSTART:20261102T150000Z',
      'DTEND:20261102T153000Z',
      'RRULE:FREQ=WEEKLY;COUNT=4',
      'SUMMARY:Weekly sync',
      'ATTENDEE;CN=Ann Smith:mailto:Ann@Customer.example',
      'ATTENDEE;CUTYPE=ROOM:mailto:room-1@corp.example',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:weekly@test',
      'RECURRENCE-ID:20261109T150000Z',
      'DTSTART:20261109T170000Z',
      'DTEND:20261109T173000Z',
      'SUMMARY:Weekly sync (moved)',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:berlin@test',
      'DTSTART;TZID=Europe/Berlin:20260715T100000',
      'DTEND;TZID=Europe/Berlin:20260715T110000',
      'SUMMARY:Summer in Berlin',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:declined@test',
      'DTSTART:20261105T090000Z',
      'DTEND:20261105T100000Z',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:James@Corp.example',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:broken@test',
      'DTSTART:20261105T090000Z',
      'RRULE:FREQ=SOMETIMES',
      'SUMMARY:Broken',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const events = parseIcs(ics, { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z'), self: ['james@corp.example'] });
    expect(events.map((e) => [e.key, e.title, e.start])).toEqual([
      ['weekly@test|2026-11-02T15:00:00.000Z', 'Weekly sync', '2026-11-02T15:00:00.000Z'],
      ['weekly@test|2026-11-09T15:00:00.000Z', 'Weekly sync (moved)', '2026-11-09T17:00:00.000Z'],
      ['weekly@test|2026-11-16T15:00:00.000Z', 'Weekly sync', '2026-11-16T15:00:00.000Z'],
      ['weekly@test|2026-11-23T15:00:00.000Z', 'Weekly sync', '2026-11-23T15:00:00.000Z'],
      // Europe/Berlin is not defined in the file; it is read as the IANA zone (UTC+2 in summer), not as UTC.
      ['berlin@test', 'Summer in Berlin', '2026-07-15T08:00:00.000Z'],
      ['declined@test', '(no title)', '2026-11-05T09:00:00.000Z'],
    ]);
    expect(events[0]!.attendees).toEqual([{ email: 'ann@customer.example', name: 'Ann Smith' }]);
    expect(events.map((e) => e.declined)).toEqual([false, false, false, false, false, true]);
    expect(() => parseIcs('<html>Sign in</html>', { from: new Date(0), to: new Date(), self: [] })).toThrow('The address did not return an iCalendar (.ics) file');
  });

  it('builds a feed with escaped text and lines folded at 75 octets', () => {
    const feed = buildIcsFeed(
      'titoForce: James',
      [
        {
          uid: 'atv_1@titoforce',
          title: 'Call, with; Ann\\Bob',
          start: '2026-11-24T09:00:00.000Z',
          end: null,
          allDay: false,
          location: null,
          description: 'Line one\nLine two',
          url: 'https://crm.example.com/r/atv_1',
          updatedAt: '2026-11-20T10:00:00.000Z',
          completed: false,
        },
        {
          uid: 'atv_2@titoforce',
          title: 'Überprüfung '.repeat(8).trim(),
          start: '2026-11-25',
          end: null,
          allDay: true,
          location: 'Room 1',
          description: null,
          url: 'https://crm.example.com/r/atv_2',
          updatedAt: '2026-11-20T10:00:00.000Z',
          completed: true,
        },
      ],
      new Date('2026-11-22T12:00:00Z'),
    );
    expect(feed.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const lines = feed.split('\r\n');
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
    const unfolded = feed.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:Call\\, with\\; Ann\\\\Bob\r\n');
    expect(unfolded).toContain('DTSTART:20261124T090000Z\r\nDTEND:20261124T093000Z\r\n');
    expect(unfolded).toContain('DESCRIPTION:Line one\\nLine two\\n\\nhttps://crm.example.com/r/atv_1\r\n');
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261126\r\n');
    expect(unfolded).toContain(`SUMMARY:✓ ${'Überprüfung '.repeat(8).trim()}\r\n`);
    expect(unfolded).toContain('X-WR-CALNAME:titoForce: James\r\n');
  });
});

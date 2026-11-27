import type { TimelineItem } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import PostalMime from 'postal-mime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Services } from '../src/services.ts';
import { createTestServices, principal } from './helpers.ts';
import { type ApiClient, b64, FakeMailServer, INTEGRATION_ENV, rfc822, signIn } from './integration-fakes.ts';

let s: Services;
let app: FastifyInstance;
const mail = new FakeMailServer();
const as: Record<string, ApiClient> = {};
let ann: string; // James's contact
let bob: string; // Priya's contact

beforeAll(async () => {
  s = await createTestServices({ env: INTEGRATION_ENV, mailTransport: mail.transport, imapFactory: mail.imap });
  app = await buildApp(s);
  for (const key of ['james', 'priya', 'sofia', 'noah']) as[key] = await signIn(app, key);
  ann = (await s.records.create(await principal(s, 'james'), 'contact', { first_name: 'Ann', last_name: 'Customer', email: 'ann@customer.example' })).id;
  bob = (await s.records.create(await principal(s, 'priya'), 'contact', { first_name: 'Bob', last_name: 'Buyer', email: 'bob@buyer.example' })).id;
});
afterAll(async () => {
  await app?.close();
  await s?.close();
});

async function timeline(who: string, object: string, id: string): Promise<TimelineItem[]> {
  const res = await as[who]!('GET', `/api/records/${object}/${id}/timeline`);
  expect(res.statusCode).toBe(200);
  return res.json().items;
}
const emailItem = (items: TimelineItem[], subject: string) => items.find((i) => i.email?.subject === subject);
const text = (value: string | undefined) => (value ?? '').replace(/\r\n/g, '\n').trim();

async function leadsWithEmail(email: string) {
  const res = await s.records.query(await principal(s, 'james'), 'lead', { filters: { match: 'all', rules: [{ field: 'email', op: 'eq', value: email }] }, pageSize: 10 });
  return res.records;
}

describe('sending email through the organization relay', () => {
  it('reports the relay as the way to send', async () => {
    expect((await as.james!('GET', '/api/integrations/status')).json().email).toEqual({ mode: 'relay', accountId: null, from: 'crm@titoforce.example' });
  });

  it('sends with the user as Reply-To and logs the email with its attachments', async () => {
    const upload = await as.james!('POST', `/api/records/contact/${ann}/attachments`, { fileName: 'terms.txt', contentType: 'text/plain', data: b64('Terms') });
    const res = await as.james!('POST', '/api/email/send', {
      recordId: ann,
      to: ['Ann@Customer.example', 'ann@customer.example'],
      cc: ['ANN@customer.example', 'carl@customer.example'],
      subject: '  Proposal   for Q1 ',
      body: 'Hi Ann,\r\nsee attached.',
      files: [{ fileName: 'quote.pdf', contentType: 'application/pdf', data: b64('%PDF quote') }],
      attachmentIds: [upload.json().id],
    });
    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result).toMatchObject({ status: 'sent', via: 'relay', from: 'crm@titoforce.example' });

    const sent = mail.sent.at(-1)!;
    expect(sent.options).toBe('smtp://relay.example:25');
    expect(sent.from).toBe('crm@titoforce.example');
    // Addresses differing only in case are one recipient, and nobody gets a copy twice.
    expect(sent.to).toEqual(['ann@customer.example', 'carl@customer.example']);
    const parsed = await PostalMime.parse(sent.raw);
    expect(parsed.from).toMatchObject({ name: 'James Chen', address: 'crm@titoforce.example' });
    expect(parsed.replyTo?.map((a) => a.address)).toEqual(['james@titoforce.example']);
    expect(parsed.to?.map((a) => a.address)).toEqual(['ann@customer.example']);
    expect(parsed.cc?.map((a) => a.address)).toEqual(['carl@customer.example']);
    expect(parsed.subject).toBe('Proposal for Q1');
    expect(text(parsed.text)).toBe('Hi Ann,\nsee attached.');
    expect(parsed.attachments.map((a) => [a.filename, a.mimeType, Buffer.from(a.content as ArrayBuffer).toString()])).toEqual([
      ['quote.pdf', 'application/pdf', '%PDF quote'],
      ['terms.txt', 'text/plain', 'Terms'],
    ]);

    const item = emailItem(await timeline('james', 'contact', ann), 'Proposal for Q1')!;
    expect(item).toMatchObject({ recordId: result.activityId, activityType: 'Email', status: 'Completed' });
    expect(item.email).toMatchObject({
      direction: 'outbound',
      status: 'sent',
      provider: 'relay',
      from: 'crm@titoforce.example',
      fromName: 'James Chen',
      to: ['ann@customer.example'],
      cc: ['carl@customer.example'],
      messageId: parsed.messageId,
    });
    expect(item.attachments?.map((a) => [a.fileName, a.size])).toEqual([
      ['quote.pdf', 10],
      ['terms.txt', 5],
    ]);
  });

  it('threads replies, and logs emails that were sent elsewhere', async () => {
    const original = emailItem(await timeline('james', 'contact', ann), 'Proposal for Q1')!;
    const reply = await as.james!('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Re: Proposal for Q1', body: 'Following up.', inReplyTo: original.recordId });
    expect(reply.statusCode).toBe(201);
    const parsed = await PostalMime.parse(mail.sent.at(-1)!.raw);
    expect(parsed.inReplyTo).toBe(original.email!.messageId);
    expect(parsed.references).toBe(original.email!.messageId);

    const sentBefore = mail.sent.length;
    const logged = await as.james!('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Call recap', body: 'Sent from my phone', logOnly: true });
    expect(logged.json()).toMatchObject({ status: 'logged', via: 'log', from: 'james@titoforce.example' });
    expect(mail.sent.length).toBe(sentBefore);
    expect(emailItem(await timeline('james', 'contact', ann), 'Call recap')!.email).toMatchObject({ status: 'logged', provider: 'manual' });
  });

  it('checks the message and the access to the record before sending', async () => {
    const note = await s.records.create(await principal(s, 'james'), 'activity', { subject: 'A note', type: 'Note', status: 'Completed', related_to: ann });
    const base = { recordId: ann, to: ['ann@customer.example'], subject: 'Hello', body: 'Hi' };
    const cases: [string, object, number, string][] = [
      ['james', { to: ['ann@customer.example', 'not-an-email'] }, 400, 'To: "not-an-email" is not a valid email address'],
      ['james', { cc: ['bad@'] }, 400, 'Cc: "bad@" is not a valid email address'],
      ['james', { to: [] }, 400, 'Add at least one recipient'],
      ['james', { subject: '   ' }, 400, 'Subject is required'],
      ['james', { inReplyTo: note.id }, 400, 'Only emails can be answered'],
      ['james', { files: [{ fileName: 'big.bin', data: Buffer.alloc(1024 * 1024 + 1).toString('base64') }] }, 400, 'Files can be at most 1 MB'],
      ['noah', {}, 404, 'Record not found'],
    ];
    const sentBefore = mail.sent.length;
    for (const [who, patch, status, message] of cases) {
      const res = await as[who]!('POST', '/api/email/send', { ...base, ...patch });
      expect([res.statusCode, res.json().error?.message], message).toEqual([status, message]);
    }
    expect(mail.sent.length).toBe(sentBefore);
  });

  it('reports a relay failure and logs nothing', async () => {
    mail.sendError = Object.assign(new Error('Message failed'), { responseCode: 550, responseText: '550 5.7.1 Relaying denied\r\nmore details' });
    try {
      const res = await as.james!('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Will bounce', body: 'x' });
      expect([res.statusCode, res.json().error.message]).toEqual([502, 'The organization mail relay did not accept the message: 550 5.7.1 Relaying denied']);
    } finally {
      mail.sendError = null;
    }
    expect(emailItem(await timeline('james', 'contact', ann), 'Will bounce')).toBeUndefined();
    expect(await s.db.get('SELECT id FROM email_messages WHERE subject = ?', ['Will bounce'])).toBeUndefined();
  });
});

describe('IMAP mailboxes', () => {
  const USER = 'james@titoforce.example';
  const settings = { address: USER, password: 'secret-1', imapHost: '127.0.0.1', imapPort: 1143, imapSecure: false, smtpHost: '127.0.0.1', smtpPort: 2525, smtpSecure: false, unmatched: 'lead' };
  let accountId: string;

  async function sync(who = 'james', id = accountId) {
    await s.jobs.drain();
    const res = await as[who]!('POST', `/api/integrations/accounts/${id}/sync`);
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  beforeAll(() => mail.addUser(USER, 'secret-1'));

  it('checks the servers before connecting a mailbox and keeps the password encrypted', async () => {
    const wrong = await as.james!('POST', '/api/integrations/imap', { ...settings, password: 'nope' });
    expect([wrong.statusCode, wrong.json().error.message]).toEqual([400, 'The IMAP server rejected the username or password']);
    expect((await as.james!('POST', '/api/integrations/imap', { ...settings, password: '' })).json().error.message).toBe('Enter the mailbox password');

    const res = await as.james!('POST', '/api/integrations/imap', settings);
    expect(res.statusCode).toBe(201);
    const account = res.json();
    accountId = account.id;
    expect(account).toMatchObject({
      provider: 'imap',
      label: USER,
      address: USER,
      status: 'active',
      capabilities: { sendEmail: true, syncEmail: true, calendar: false, exportEvents: false },
      settings: { imapHost: '127.0.0.1', imapPort: 1143, imapSecure: false, smtpHost: '127.0.0.1', smtpPort: 2525, smtpSecure: false, username: USER, syncEmail: true, unmatched: 'lead' },
    });
    expect(res.body).not.toContain('secret-1');
    const row = await s.db.get<Record<string, unknown>>('SELECT * FROM connected_accounts WHERE id = ?', [accountId]);
    expect(JSON.stringify(row)).not.toContain('secret-1');
    expect(mail.imapConnections.at(-1)).toMatchObject({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: USER, pass: 'secret-1' } });
    expect(mail.transports.at(-1)).toMatchObject({ host: '127.0.0.1', port: 2525, secure: false, requireTLS: false, auth: { user: USER, pass: 'secret-1' } });

    const again = await as.james!('POST', '/api/integrations/imap', settings);
    expect([again.statusCode, again.json().error.message]).toEqual([409, 'This mailbox is already connected']);
    await s.jobs.drain();
    expect((await as.james!('GET', '/api/integrations/status')).json().email).toEqual({ mode: 'account', accountId, from: USER });
  });

  it('logs mail with customers, creates leads for unknown senders, and skips newsletters and internal mail', async () => {
    await mail.deliver(USER, 'INBOX', rfc822({
      from: 'Ann Customer <ann@customer.example>',
      to: USER,
      subject: 'Brochure',
      messageId: '<ann-1@customer.example>',
      attachment: { name: 'brochure.pdf', type: 'application/pdf', content: '%PDF brochure' },
    }));
    await mail.deliver(USER, 'INBOX', rfc822({ from: 'Shop <news@shop.example>', to: USER, subject: 'Big sale', messageId: '<news-1@shop.example>', headers: ['List-Unsubscribe: <https://shop.example/u>'] }));
    await mail.deliver(USER, 'INBOX', rfc822({ from: 'Dana New <dana@newco.example>', to: USER, subject: 'Interested in a demo', messageId: '<dana-1@newco.example>', text: 'Can we talk?' }));
    await mail.deliver(USER, 'INBOX', rfc822({ from: 'Maria Garcia <maria@titoforce.example>', to: USER, subject: 'Team lunch', messageId: '<lunch@titoforce.example>' }));
    await mail.deliver(USER, 'Sent', rfc822({ from: `James Chen <${USER}>`, to: 'bob@buyer.example', subject: 'Intro', messageId: '<intro@titoforce.example>' }));

    const { result, account } = await sync();
    expect(result).toEqual({ mail: { logged: 3, duplicates: 0, skipped: 2 }, calendar: null, error: null });
    expect(account.lastSyncAt).toBeTruthy();
    // Mail between colleagues is not even downloaded.
    expect(mail.downloads).not.toContain(`${USER}:INBOX/4`);

    const brochure = emailItem(await timeline('james', 'contact', ann), 'Brochure')!;
    expect(brochure.email).toMatchObject({ direction: 'inbound', status: 'received', provider: 'imap', from: 'ann@customer.example', fromName: 'Ann Customer', to: [USER] });
    expect(brochure.attachments?.map((a) => [a.fileName, a.contentType, a.size])).toEqual([['brochure.pdf', 'application/pdf', 13]]);

    const [lead] = await leadsWithEmail('dana@newco.example');
    expect(lead).toMatchObject({ name: 'Dana New', ownerId: (await principal(s, 'james')).userId });
    expect(emailItem(await timeline('james', 'lead', lead!.id), 'Interested in a demo')!.email!.direction).toBe('inbound');
    expect(await leadsWithEmail('news@shop.example')).toEqual([]);

    // Bob belongs to Priya; James can read him, so mail James sent him is logged there.
    expect(emailItem(await timeline('priya', 'contact', bob), 'Intro')!.email).toMatchObject({ direction: 'outbound', status: 'sent', to: ['bob@buyer.example'] });
  });

  it('logs replies in their thread and recognizes copies of emails sent from the CRM', async () => {
    // Someone else answers Ann's email: the thread decides where it belongs (no lead is created).
    await mail.deliver(USER, 'INBOX', rfc822({ from: 'Assistant <assistant@othercorp.example>', to: USER, subject: 'Re: Brochure', messageId: '<asst-1@othercorp.example>', inReplyTo: '<ann-1@customer.example>' }));

    // Sent through the mailbox: a copy goes to its Sent folder and is known by its Message-ID.
    const agenda = await as.james!('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Agenda', body: 'Agenda for Monday' });
    expect(agenda.json()).toMatchObject({ status: 'sent', via: 'account', from: USER });
    expect(mail.sent.at(-1)!.options).toMatchObject({ host: '127.0.0.1', port: 2525, auth: { user: USER } });
    await s.jobs.drain();
    expect(mail.folder(USER, 'Sent').messages).toHaveLength(2);

    // Some providers file their own copy under a new Message-ID instead of the appended one.
    mail.dropAppends = true;
    await as.james!('POST', '/api/email/send', { recordId: ann, to: ['ann@customer.example'], subject: 'Pricing', body: 'Our prices' });
    await s.jobs.drain();
    mail.dropAppends = false;
    await mail.deliver(USER, 'Sent', rfc822({ from: `James Chen <${USER}>`, to: 'ann@customer.example', subject: 'Pricing', messageId: '<provider-copy@mail.example>' }));

    expect((await sync()).result.mail).toEqual({ logged: 1, duplicates: 2, skipped: 0 });
    expect(emailItem(await timeline('james', 'contact', ann), 'Re: Brochure')!.email!.from).toBe('assistant@othercorp.example');
    expect(await leadsWithEmail('assistant@othercorp.example')).toEqual([]);
    const pricing = await s.db.get<{ message_id: string }>('SELECT message_id FROM email_messages WHERE subject = ?', ['Pricing']);
    expect(pricing!.message_id).toBe('<provider-copy@mail.example>');

    // Ann answers from another address, referring to the provider's Message-ID: still logged in the thread.
    await mail.deliver(USER, 'INBOX', rfc822({ from: 'Ann <ann.private@home.example>', to: USER, subject: 'Re: Pricing', messageId: '<ann-2@home.example>', inReplyTo: '<provider-copy@mail.example>' }));
    expect((await sync()).result.mail).toEqual({ logged: 1, duplicates: 0, skipped: 0 });
    expect(emailItem(await timeline('james', 'contact', ann), 'Re: Pricing')).toBeDefined();
    expect(await leadsWithEmail('ann.private@home.example')).toEqual([]);
  });

  it('does not log a deleted email again', async () => {
    const brochure = emailItem(await timeline('james', 'contact', ann), 'Brochure')!;
    await s.records.delete(await principal(s, 'james'), 'activity', brochure.recordId!);
    expect(await s.db.get('SELECT activity_id, subject FROM email_messages WHERE message_id = ?', ['<ann-1@customer.example>'])).toEqual({ activity_id: null, subject: '' });

    // Read the whole mailbox again, as after the server reset its UIDs.
    const account = (await s.integrations.accounts.get(accountId))!;
    await s.integrations.accounts.setSyncState(accountId, { ...account.syncState, imap: {} });
    expect((await sync()).result.mail.logged).toBe(0);
    expect(emailItem(await timeline('james', 'contact', ann), 'Brochure')).toBeUndefined();
  });

  it('asks for the new password when the server rejects the stored one', async () => {
    mail.setPassword(USER, 'rotated-2');
    const { result, account } = await sync();
    expect(result.error).toBe('Email: The IMAP server rejected the username or password. Update the password in Settings.');
    expect(account).toMatchObject({ status: 'error', lastError: result.error });

    const wrong = await as.james!('PUT', `/api/integrations/imap/${accountId}`, { ...settings, password: 'still-wrong' });
    expect([wrong.statusCode, wrong.json().error.message]).toEqual([400, 'The IMAP server rejected the username or password']);
    const fixed = await as.james!('PUT', `/api/integrations/imap/${accountId}`, { ...settings, password: 'rotated-2' });
    expect(fixed.json()).toMatchObject({ status: 'active', lastError: null });
    expect((await sync()).result.error).toBeNull();
  });

  it('opens cases for mail from unknown senders when the mailbox is set up for support', async () => {
    mail.addUser('support@titoforce.example', 'support-pw');
    const res = await as.sofia!('POST', '/api/integrations/imap', {
      address: 'support@titoforce.example',
      password: 'support-pw',
      imapHost: '127.0.0.1',
      imapPort: 1143,
      imapSecure: false,
      unmatched: 'case',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().capabilities.sendEmail).toBe(false);
    // Connecting starts a first sync in the background; let it finish so the message below is read by the sync call.
    await s.jobs.drain();
    await mail.deliver('support@titoforce.example', 'INBOX', rfc822({ from: 'Zoe Client <zoe@client.example>', to: 'support@titoforce.example', subject: 'Printer on fire', messageId: '<zoe-1@client.example>', text: 'Please help!' }));
    expect((await sync('sofia', res.json().id)).result.mail).toEqual({ logged: 1, duplicates: 0, skipped: 0 });

    const sofia = await principal(s, 'sofia');
    const cases = await s.records.query(sofia, 'case', { filters: { match: 'all', rules: [{ field: 'supplied_email', op: 'eq', value: 'zoe@client.example' }] }, pageSize: 5 });
    expect(cases.records).toHaveLength(1);
    expect(cases.records[0]!.fields).toMatchObject({ subject: 'Printer on fire', origin: 'Email', supplied_name: 'Zoe Client', description: 'Please help!' });
    expect(emailItem(await timeline('sofia', 'case', cases.records[0]!.id), 'Printer on fire')).toBeDefined();
  });

  it('keeps mailboxes private to their owner, and keeps logged email after disconnecting', async () => {
    expect((await as.priya!('PATCH', `/api/integrations/accounts/${accountId}`, { syncEmail: false })).statusCode).toBe(404);
    expect((await as.priya!('POST', `/api/integrations/accounts/${accountId}/sync`)).statusCode).toBe(404);
    expect((await as.priya!('DELETE', `/api/integrations/accounts/${accountId}`)).statusCode).toBe(404);
    expect((await as.priya!('GET', '/api/integrations/accounts')).json()).toEqual([]);

    const patched = await as.james!('PATCH', `/api/integrations/accounts/${accountId}`, { label: 'Work mail', unmatched: 'ignore' });
    expect(patched.json()).toMatchObject({ label: 'Work mail', settings: { unmatched: 'ignore' } });
    expect((await as.james!('DELETE', `/api/integrations/accounts/${accountId}`)).json()).toEqual({ ok: true });
    expect((await as.james!('GET', '/api/integrations/accounts')).json()).toEqual([]);
    expect(emailItem(await timeline('james', 'contact', ann), 'Agenda')).toBeDefined();
  });
});

describe('without email configuration', () => {
  let s2: Services;
  let app2: FastifyInstance;
  let james: ApiClient;

  beforeAll(async () => {
    s2 = await createTestServices({ mailTransport: mail.transport, imapFactory: mail.imap });
    app2 = await buildApp(s2);
    james = await signIn(app2, 'james');
  });
  afterAll(async () => {
    await app2?.close();
    await s2?.close();
  });

  it('logs emails but cannot send them', async () => {
    const contact = await s2.records.create(await principal(s2, 'james'), 'contact', { last_name: 'Solo', email: 'solo@customer.example' });
    expect((await james('GET', '/api/integrations/status')).json().email).toEqual({ mode: 'log', accountId: null, from: null });
    const email = { recordId: contact.id, to: ['solo@customer.example'], subject: 'Hi', body: 'Hi' };
    const res = await james('POST', '/api/email/send', email);
    expect([res.statusCode, res.json().error.message]).toEqual([
      400,
      'Email sending is not set up: connect a mailbox in Settings, or ask an administrator to configure the SMTP relay. You can still log the email.',
    ]);
    expect((await james('POST', '/api/email/send', { ...email, logOnly: true })).json()).toMatchObject({ status: 'logged', via: 'log' });
  });

  it('only connects to mail servers on public addresses and standard ports', async () => {
    const connections = mail.imapConnections.length;
    const body = { address: 'james@titoforce.example', password: 'pw', imapHost: '127.0.0.1', imapPort: 993, imapSecure: true };
    expect((await james('POST', '/api/integrations/imap', body)).json().error.message).toBe(
      '127.0.0.1 is on a private network, which is not allowed (set TITO_ALLOW_PRIVATE_NETWORK=true for local testing)',
    );
    expect((await james('POST', '/api/integrations/imap', { ...body, imapHost: '[::1]' })).json().error.message).toBe(
      '::1 is on a private network, which is not allowed (set TITO_ALLOW_PRIVATE_NETWORK=true for local testing)',
    );
    expect((await james('POST', '/api/integrations/imap', { ...body, imapPort: 1143 })).json().error.message).toBe('IMAP port must be one of 143, 993');
    expect(mail.imapConnections.length).toBe(connections);
  });
});

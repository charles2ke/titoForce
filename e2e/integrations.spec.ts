import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { calendarFile, EMAIL_FROM, GOOGLE_CLIENT_ID, mailHeaders, MICROSOFT_CLIENT_ID, serveCalendar, startSmtpRelay, TWILIO, twilioSignature } from './fakes.ts';
import { email, signIn, snap } from './helpers.ts';

interface Contact {
  id: string;
  name: string;
  email: string;
}

let serial = 0;

/** A contact owned by the signed-in user, with a unique email address. */
async function createContact(page: Page, first: string, last: string, fields: Record<string, string> = {}): Promise<Contact> {
  const address = `${first}.${last}.${Date.now().toString(36)}${serial++}@northwind-e2e.example`.toLowerCase();
  const res = await page.request.post('/api/records/contact', { data: { fields: { first_name: first, last_name: last, email: address, ...fields } } });
  expect(res.status(), `create contact ${first} ${last}`).toBe(201);
  const { record } = (await res.json()) as { record: { id: string; name: string } };
  return { id: record.id, name: record.name, email: address };
}

/** A timeline entry, found by its title. */
const timelineItem = (page: Page, section: 'History' | 'Upcoming and overdue', title: string) =>
  page
    .getByRole('region', { name: section })
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });

/** Posts a webhook the way Twilio does: form-encoded and signed with the auth token. Returns the TwiML reply. */
async function twilioWebhook(request: APIRequestContext, url: string, params: Record<string, string>): Promise<string> {
  const res = await request.post(url, { form: params, headers: { 'x-twilio-signature': twilioSignature(url, params) } });
  expect(res.status(), url).toBe(200);
  expect(res.headers()['content-type']).toContain('text/xml');
  return res.text();
}

/** Disconnects the signed-in user's accounts with this label, left over from an earlier attempt. */
async function disconnectAccounts(page: Page, label: string): Promise<void> {
  const accounts = (await (await page.request.get('/api/integrations/accounts')).json()) as { id: string; label: string }[];
  for (const a of accounts.filter((x) => x.label === label)) expect((await page.request.delete(`/api/integrations/accounts/${a.id}`)).ok()).toBe(true);
}

/** A local port that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('sends an email with an attachment through the mail relay and replies in the same thread', async ({ page }) => {
  const relay = await startSmtpRelay();
  try {
    await signIn(page, 'maria');
    const dana = await createContact(page, 'Dana', 'Whitfield');
    await page.goto(`/r/${dana.id}`);
    await page.getByRole('radio', { name: 'Email' }).click();
    const form = page.getByRole('form', { name: 'Email', exact: true });
    await expect(form.getByText(`From ${EMAIL_FROM} on your behalf; replies go to you.`)).toBeVisible();
    await expect(form.getByLabel('To', { exact: true })).toHaveValue(dana.email);
    await form.getByLabel('Subject', { exact: true }).fill('Proposal for Northwind');
    await form.getByLabel('Message', { exact: true }).fill('Hi Dana,\n\nAs promised, our proposal is attached.\n\nMaria');
    await form.getByLabel('Attach files').setInputFiles({ name: 'proposal.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% titoForce e2e\n') });
    await expect(form.getByRole('list', { name: 'Attachments' })).toContainText('proposal.pdf');
    await snap(page, '13-email-composer');

    await form.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Email sent', { exact: true })).toBeVisible();
    const sent = timelineItem(page, 'History', 'Proposal for Northwind');
    await expect(sent.getByText('Sent', { exact: true })).toBeVisible();
    await expect(sent.getByText(`To ${dana.email}`)).toBeVisible();
    await expect(sent.getByRole('list', { name: 'Attachments of Proposal for Northwind' }).getByRole('link', { name: /proposal\.pdf/ })).toBeVisible();

    // The relay received the message from the organization's address, with replies going to Maria.
    expect(relay.messages).toHaveLength(1);
    const [first] = relay.messages;
    expect(first!.from).toBe(EMAIL_FROM);
    expect(first!.to).toEqual([dana.email]);
    const headers = mailHeaders(first!.data);
    expect(headers.get('subject')).toBe('Proposal for Northwind');
    expect(headers.get('reply-to')).toContain(email('maria'));
    expect(first!.data).toMatch(/filename="?proposal\.pdf"?/);
    const messageId = headers.get('message-id');
    expect(messageId).toMatch(/^<.+@.+>$/);

    await sent.getByRole('button', { name: 'Reply to “Proposal for Northwind”' }).click();
    await expect(form.getByText('Replying to “Proposal for Northwind”')).toBeVisible();
    await expect(form.getByLabel('Subject', { exact: true })).toHaveValue('Re: Proposal for Northwind');
    await expect(form.getByLabel('To', { exact: true })).toHaveValue(dana.email);
    await form.getByLabel('Message', { exact: true }).fill('Hi Dana, a quick follow-up: does the proposal work for you?');
    await form.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(timelineItem(page, 'History', 'Re: Proposal for Northwind').getByText('Sent', { exact: true })).toBeVisible();
    await expect(form.getByText('Replying to “Proposal for Northwind”')).toHaveCount(0);

    // The reply continues the conversation in the customer's mailbox.
    expect(relay.messages).toHaveLength(2);
    const reply = mailHeaders(relay.messages[1]!.data);
    expect(reply.get('in-reply-to')).toBe(messageId);
    expect(reply.get('references')).toContain(messageId);
    await snap(page, '14-email-thread');
  } finally {
    await relay.close();
  }
});

test('uploads, downloads and deletes a file on a record', async ({ page }) => {
  await signIn(page, 'maria');
  const contact = await createContact(page, 'Omar', 'Haddad');
  await page.goto(`/r/${contact.id}`);
  await expect(page.getByText('No files yet. Drop files here or upload them.')).toBeVisible();
  await page.getByLabel('Upload files').setInputFiles({ name: 'requirements.txt', mimeType: 'text/plain', buffer: Buffer.from('Single sign-on\nAudit log\n') });
  await expect(page.getByText('“requirements.txt” uploaded')).toBeVisible();
  const files = page.getByRole('list', { name: 'Files', exact: true });
  const link = files.getByRole('link', { name: 'requirements.txt' });
  await expect(link).toBeVisible();
  await expect(files).toContainText('Maria Garcia');
  await snap(page, '15-record-files');

  const downloading = page.waitForEvent('download');
  await link.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('requirements.txt');
  expect(await readFile(await download.path(), 'utf8')).toBe('Single sign-on\nAudit log\n');

  await files.getByRole('button', { name: 'Delete requirements.txt' }).click();
  await page.getByRole('dialog', { name: 'Delete file?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('“requirements.txt” deleted')).toBeVisible();
  await expect(page.getByText('No files yet. Drop files here or upload them.')).toBeVisible();
});

test('forwards a call to the record owner, and logs it as missed when nobody answers', async ({ page, request, baseURL }) => {
  await signIn(page, 'maria');
  // Starts without a number so the form below always has something to save.
  expect((await page.request.put('/api/integrations/phone', { data: { phone: null } })).ok()).toBe(true);
  await page.goto('/settings');
  const phoneForm = page.getByRole('form', { name: 'Phone' });
  await phoneForm.getByLabel('Your phone number').fill('call me');
  await phoneForm.getByRole('button', { name: 'Save' }).click();
  await expect(phoneForm.getByRole('alert')).toContainText('Enter your number in international format');
  await phoneForm.getByLabel('Your phone number').fill('(415) 555-0100');
  await phoneForm.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Phone number saved')).toBeVisible();
  await expect(phoneForm.getByLabel('Your phone number')).toHaveValue('+14155550100');

  const caller = `+1628555${String(Date.now() % 10_000).padStart(4, '0')}`;
  const ravi = await createContact(page, 'Ravi', 'Shah', { phone: caller.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '+1 $1 $2 $3') });
  const call = { AccountSid: TWILIO.accountSid, CallSid: `CA${Date.now()}e2e`, From: caller, To: TWILIO.number, Direction: 'inbound' };
  const voiceUrl = `${baseURL}/api/telephony/twilio/voice`;

  // Requests that do not carry Twilio's signature are refused.
  const forged = await request.post(voiceUrl, { form: { ...call, CallStatus: 'ringing' }, headers: { 'x-twilio-signature': 'forged' } });
  expect(forged.status()).toBe(403);

  // Ravi calls the company number: Twilio is told to ring Maria, who owns his record.
  const voice = await twilioWebhook(request, voiceUrl, { ...call, CallStatus: 'ringing' });
  expect(voice).toMatch(/<Dial [^>]*answerOnBridge="true"/);
  expect(voice).toContain('>+14155550100</Number>');
  const action = /<Dial [^>]*action="([^"]+)"/.exec(voice)?.[1]?.replaceAll('&amp;', '&');
  expect(action).toMatch(/\/api\/telephony\/twilio\/dial-status\?call=/);

  // Maria does not pick up: Twilio reports the outcome of the <Dial> to its action URL.
  const after = await twilioWebhook(request, action!, { ...call, CallStatus: 'in-progress', DialCallStatus: 'no-answer' });
  expect(after).toContain('<Say>');

  await page.goto(`/r/${ravi.id}`);
  const missed = timelineItem(page, 'Upcoming and overdue', `Missed call from ${ravi.name}`);
  await expect(missed).toContainText(`Inbound · No answer · ${caller}`);
  await missed.scrollIntoViewIfNeeded();
  await expect(page.getByText('titoForce rings your phone (+14155550100) first, then connects you.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Notifications \(\d+ unread\)$/ }).click();
  await expect(page.getByRole('button').filter({ hasText: `Missed call from ${ravi.name}` }).filter({ hasText: caller })).toBeVisible();
  await snap(page, '16-missed-call');
});

test('schedules a meeting and publishes it in the personal calendar link', async ({ page, request }) => {
  await signIn(page, 'maria');
  const lena = await createContact(page, 'Lena', 'Fischer');
  await page.goto(`/r/${lena.id}`);
  await page.getByRole('radio', { name: 'Meeting' }).click();
  const form = page.getByRole('form', { name: 'Schedule a meeting' });
  const day = new Date(Date.now() + 2 * 86_400_000);
  const isoDay = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  await form.getByLabel('Subject', { exact: true }).fill('Pilot kickoff');
  await form.getByLabel('Date', { exact: true }).fill(isoDay);
  await form.getByLabel('Start time').fill('10:00');
  await form.getByLabel('Duration').selectOption({ label: '1 hour' });
  await form.getByLabel('Location').fill('Zoom');
  await expect(form.getByLabel('Attendees')).toHaveValue(lena.email);
  await form.getByRole('button', { name: 'Schedule meeting' }).click();
  await expect(page.getByText('Meeting scheduled', { exact: true })).toBeVisible();
  const meeting = timelineItem(page, 'Upcoming and overdue', 'Pilot kickoff');
  await expect(meeting).toContainText(/10:00\D*–\s*11:00/);
  await expect(meeting).toContainText('Zoom');
  await expect(meeting).toContainText('1 attendee');
  await meeting.scrollIntoViewIfNeeded();
  await snap(page, '17-meeting-scheduled');

  // Starts without a link: once one exists, the card offers to replace it instead.
  expect((await page.request.delete('/api/integrations/calendar-feed')).ok()).toBe(true);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Create calendar link' }).click();
  const link = page.getByLabel('Calendar link', { exact: true });
  await expect(link).toHaveValue(/^http:\/\/127\.0\.0\.1:\d+\/api\/calendar\/feed\/[\w-]+\.ics$/);
  // Calendar apps fetch the link without a session.
  const feed = await request.get(await link.inputValue());
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('text/calendar');
  const ics = await feed.text();
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('SUMMARY:Pilot kickoff');
  expect(ics).toContain('LOCATION:Zoom');
});

test('subscribes to a calendar address and imports meetings with contacts', async ({ page }) => {
  await signIn(page, 'maria');
  const grace = await createContact(page, 'Grace', 'Okafor');
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(15, 0, 0, 0);
  const calendar = await serveCalendar(
    calendarFile([
      {
        uid: `qbr-${grace.id}@calendar.example`,
        title: 'Quarterly business review',
        start,
        end: new Date(start.getTime() + 3_600_000),
        organizer: email('maria'),
        attendees: [email('maria'), grace.email],
        location: 'Northwind HQ',
      },
    ]),
  );
  const label = 'Team calendar';
  await disconnectAccounts(page, label);
  try {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Subscribe to a calendar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Subscribe to a calendar' });
    await dialog.getByLabel('Calendar address').fill(calendar.url);
    await dialog.getByLabel('Name').fill(label);
    await dialog.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await expect(page.getByText(`Subscribed to ${label}`)).toBeVisible();
    const account = page.getByRole('list', { name: 'Connected accounts' }).getByRole('listitem', { name: label });
    // The first sync runs in the background; the list refreshes until it is done.
    await expect(account).toContainText('Calendar address · 127.0.0.1 · Synced');
    await expect(account.getByText('Last sync failed')).toHaveCount(0);
    await snap(page, '18-settings-integrations');

    await page.goto(`/r/${grace.id}`);
    const meeting = timelineItem(page, 'Upcoming and overdue', 'Quarterly business review');
    await expect(meeting.getByText('Subscribed calendar', { exact: true })).toBeVisible();
    await expect(meeting).toContainText('Northwind HQ');
    // Maria's own address is not counted.
    await expect(meeting).toContainText('1 attendee');
    await meeting.scrollIntoViewIfNeeded();
    await snap(page, '19-imported-meeting');

    await page.goto('/settings');
    await account.getByRole('button', { name: `More actions for ${label}` }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('dialog', { name: `Disconnect ${label}?` }).getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText(`${label} disconnected`)).toBeVisible();
    await expect(account).toHaveCount(0);
  } finally {
    await calendar.close();
  }
  // Meetings already logged stay on the record.
  const timeline = await page.request.get(`/api/records/contact/${grace.id}/timeline`);
  const { items } = (await timeline.json()) as { items: { title: string }[] };
  expect(items.map((i) => i.title)).toContain('Quarterly business review');
});

test('checks the mailbox servers before connecting an IMAP account', async ({ page }) => {
  await signIn(page, 'maria');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect a mailbox (IMAP)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect a mailbox' });
  await dialog.getByLabel('Email address').fill('maria@northwind-e2e.example');
  await dialog.getByLabel('Password').fill('app-password');
  await dialog.getByLabel('Password').press('Tab');
  // The servers are guessed from the address.
  await expect(dialog.getByLabel('IMAP server')).toHaveValue('imap.northwind-e2e.example');
  await expect(dialog.getByLabel('SMTP server')).toHaveValue('smtp.northwind-e2e.example');

  const port = await closedPort();
  await dialog.getByLabel('IMAP server').fill('127.0.0.1');
  await dialog.getByLabel('IMAP port').fill(String(port));
  await dialog.getByLabel('SMTP server').fill('');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(`Could not connect to the IMAP server`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('list', { name: 'Connected accounts' }).getByRole('listitem', { name: 'maria@northwind-e2e.example' })).toHaveCount(0);
});

test('sends people to Google and Microsoft to connect their accounts, and reports a declined consent', async ({ page, baseURL }) => {
  await signIn(page, 'maria');
  const providers = [
    { id: 'google', button: 'Connect Google', host: 'https://accounts.google.com', path: '/o/oauth2/v2/auth', clientId: GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/gmail.send' },
    {
      id: 'microsoft',
      button: 'Connect Microsoft 365',
      host: 'https://login.microsoftonline.com',
      path: '/common/oauth2/v2.0/authorize',
      clientId: MICROSOFT_CLIENT_ID,
      scope: 'Mail.Send',
    },
  ];
  for (const p of providers) {
    // The provider's sign-in page is simulated: no request leaves the machine.
    await page.route(`${p.host}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
    await page.goto('/settings');
    await page.getByRole('button', { name: p.button }).click();
    await page.waitForURL(`${p.host}/**`);
    const url = new URL(page.url());
    expect(url.pathname).toBe(p.path);
    expect(url.searchParams.get('client_id')).toBe(p.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/integrations/oauth/${p.id}/callback`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')?.split(' ')).toContain(p.scope);
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();

    // The person declines: the provider sends the browser back without a code.
    await page.goto(`/api/integrations/oauth/${p.id}/callback?error=access_denied&state=${encodeURIComponent(state!)}`);
    await expect(page).toHaveURL(/\/settings$/);
    const alert = page.getByRole('alert').filter({ hasText: 'The account was not connected.' });
    await expect(alert).toContainText('Access was not granted.');
    if (p.id === 'google') await snap(page, '20-oauth-declined');
    await alert.getByRole('button', { name: 'Dismiss' }).click();
    await expect(alert).toHaveCount(0);
  }
});

test('shows administrators how the integrations are set up', async ({ page, baseURL }) => {
  await signIn(page, 'admin');
  await page.goto('/setup');
  await page.getByRole('link', { name: 'Email, Calendar & Phone' }).click();
  await expect(page).toHaveURL(/\/setup\/integrations$/);
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible();
  await expect(page.getByText('Secret key set')).toBeVisible();
  // Exact: each field also has a "Copy …" button.
  await expect(page.getByLabel('Public address', { exact: true })).toHaveValue(baseURL!);
  await expect(page.getByLabel('Google redirect URI', { exact: true })).toHaveValue(`${baseURL}/api/integrations/oauth/google/callback`);
  await expect(page.getByLabel('Microsoft redirect URI', { exact: true })).toHaveValue(`${baseURL}/api/integrations/oauth/microsoft/callback`);
  await expect(page.getByLabel('Twilio voice webhook', { exact: true })).toHaveValue(`${baseURL}/api/telephony/twilio/voice`);
  await snap(page, '21-setup-integrations');
});

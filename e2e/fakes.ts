// Local stand-ins for the services titoForce integrates with, so the end-to-end tests run the real network paths
// (an SMTP relay, a calendar address, Twilio's webhooks) without reaching any outside service.
import { createHmac } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { type AddressInfo, createServer as createTcpServer, type Socket } from 'node:net';

/** The port of the organization mail relay (TITO_SMTP_URL) of the test server; `startSmtpRelay` listens on it. */
export const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? Number(process.env.E2E_PORT ?? 3457) + 1);
export const EMAIL_FROM = 'crm@titoforce.example';

/** Made-up credentials: the test server never calls Twilio, and the tests sign its webhooks with the auth token. */
export const TWILIO = { accountSid: 'e2e-fake-account', authToken: 'e2e-twilio-auth-token', number: '+14155550199' };
export const GOOGLE_CLIENT_ID = 'e2e-client.apps.googleusercontent.com';
export const MICROSOFT_CLIENT_ID = '00000000-0000-0000-0000-00000000e2e0';

export interface RelayedMail {
  from: string;
  to: string[];
  /** The message as sent (headers and MIME body). */
  data: string;
}

export interface SmtpRelay {
  messages: RelayedMail[];
  close(): Promise<void>;
}

/** A minimal SMTP server that accepts every message, like a local relay without TLS or authentication. */
export async function startSmtpRelay(port = SMTP_PORT): Promise<SmtpRelay> {
  const messages: RelayedMail[] = [];
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    const reply = (line: string) => socket.write(`${line}\r\n`);
    let buffer = '';
    let from = '';
    let to: string[] = [];
    let data: string | null = null;
    const handle = (line: string) => {
      if (data !== null) {
        if (line !== '.') {
          data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          return;
        }
        messages.push({ from, to, data });
        data = null;
        to = [];
        return reply('250 2.0.0 Queued');
      }
      const address = () => /<([^>]*)>/.exec(line)?.[1] ?? '';
      switch (line.split(' ')[0]!.toUpperCase()) {
        case 'EHLO':
          return socket.write('250-e2e-relay\r\n250 8BITMIME\r\n');
        case 'HELO':
          return reply('250 e2e-relay');
        case 'MAIL':
          from = address();
          to = [];
          return reply('250 2.1.0 OK');
        case 'RCPT':
          to.push(address());
          return reply('250 2.1.5 OK');
        case 'DATA':
          data = '';
          return reply('354 End data with <CR><LF>.<CR><LF>');
        case 'RSET':
          to = [];
          return reply('250 2.0.0 OK');
        case 'NOOP':
          return reply('250 2.0.0 OK');
        case 'QUIT':
          reply('221 2.0.0 Bye');
          return socket.end();
        default:
          return reply('502 5.5.2 Command not recognized');
      }
    };
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let nl = buffer.indexOf('\r\n'); nl >= 0; nl = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        handle(line);
      }
    });
    reply('220 e2e-relay ESMTP');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** The header fields of a message (unfolded), by lowercase name. */
export function mailHeaders(data: string): Map<string, string> {
  const head = data.slice(0, data.indexOf('\r\n\r\n')).replace(/\r\n[ \t]+/g, ' ');
  const out = new Map<string, string>();
  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) out.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return out;
}

export interface CalendarEventInput {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  organizer: string;
  attendees: string[];
  location?: string;
}

const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function calendarFile(events: CalendarEventInput[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//titoForce//e2e//EN'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsTime(new Date())}`,
      `DTSTART:${icsTime(e.start)}`,
      `DTEND:${icsTime(e.end)}`,
      `SUMMARY:${e.title}`,
      ...(e.location ? [`LOCATION:${e.location}`] : []),
      `ORGANIZER:mailto:${e.organizer}`,
      ...e.attendees.map((a) => `ATTENDEE;PARTSTAT=ACCEPTED:mailto:${a}`),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/** Publishes an iCalendar file at a local address, like a calendar's "secret address in iCal format". */
export async function serveCalendar(ics: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = createHttpServer((req, res) => {
    if (req.url !== '/calendar.ics') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' }).end(ics);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/calendar.ics`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The X-Twilio-Signature Twilio sends with a webhook: HMAC-SHA1 of the URL and the sorted form fields. */
export function twilioSignature(url: string, params: Record<string, string>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');
  return createHmac('sha1', TWILIO.authToken).update(data, 'utf8').digest('base64');
}

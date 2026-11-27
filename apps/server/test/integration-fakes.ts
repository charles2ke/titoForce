import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { ImapFlowOptions } from 'imapflow';
import PostalMime from 'postal-mime';
import { expect } from 'vitest';
import { twilioSignature } from '../src/integrations/telephony.ts';
import type { ImapClient, MailTransport, SmtpOptions } from '../src/integrations/types.ts';

/** Configuration of a server with every integration turned on (providers are faked, nothing leaves the machine). */
export const INTEGRATION_ENV = {
  TITO_PUBLIC_URL: 'https://crm.example.com',
  TITO_SECRET_KEY: 'integration-test-secret',
  TITO_SMTP_URL: 'smtp://relay.example:25',
  TITO_EMAIL_FROM: 'crm@titoforce.example',
  TITO_GOOGLE_CLIENT_ID: 'google-client',
  TITO_GOOGLE_CLIENT_SECRET: 'google-secret',
  TITO_MICROSOFT_CLIENT_ID: 'microsoft-client',
  TITO_MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
  TITO_TWILIO_ACCOUNT_SID: 'AC123',
  TITO_TWILIO_AUTH_TOKEN: 'twilio-token',
  TITO_TWILIO_NUMBER: '+14155550000',
  TITO_DEFAULT_CALLING_CODE: '1',
  TITO_ALLOW_PRIVATE_NETWORK: 'true',
  TITO_ATTACHMENT_MAX_MB: '1',
  TITO_SYNC_INTERVAL_MINUTES: '0',
};

export const JSON_HEADERS = { 'content-type': 'application/json' };

export async function login(app: FastifyInstance, key: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${key}@titoforce.example`, password: 'titoforce' } });
  expect(res.statusCode).toBe(200);
  return `tf_session=${res.cookies.find((c) => c.name === 'tf_session')!.value}`;
}

export type ApiClient = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => Promise<LightMyRequestResponse>;

/** Calls the API as a signed-in user; bodies are sent as JSON (an empty object when none is given). */
export async function signIn(app: FastifyInstance, key: string): Promise<ApiClient> {
  const cookie = await login(app, key);
  return (method, url, payload) =>
    method === 'GET' || method === 'DELETE'
      ? app.inject({ method, url, headers: { cookie } })
      : app.inject({ method, url, headers: { cookie, ...JSON_HEADERS }, payload: JSON.stringify(payload ?? {}) });
}

export const b64 = (text: string | Buffer): string => Buffer.from(text).toString('base64');

// ---------- HTTP APIs (Google, Microsoft, Twilio) ----------

export interface FakeRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
  raw: Buffer;
}

type Handler = (req: FakeRequest) => unknown;

/** A scripted `fetch`: the most recently added matching route answers (plain values are sent as JSON). */
export class FakeHttp {
  requests: FakeRequest[] = [];
  private routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

  /** `pattern` is matched against the origin and path of the URL (not the query). */
  on(method: string, pattern: RegExp, handler: Handler): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  find(method: string, pattern: RegExp): FakeRequest[] {
    return this.requests.filter((r) => r.method === method && pattern.test(r.url.origin + r.url.pathname));
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body;
    const raw =
      body == null ? Buffer.alloc(0) : typeof body === 'string' || body instanceof URLSearchParams ? Buffer.from(body.toString()) : Buffer.from(body as Uint8Array);
    const req: FakeRequest = { method, url, headers: new Headers(init?.headers), body: raw.toString(), raw };
    this.requests.push(req);
    const route = this.routes.findLast((r) => r.method === method && r.pattern.test(url.origin + url.pathname));
    if (!route) return Response.json({ error: { message: `No fake for ${method} ${url}` } }, { status: 500 });
    const reply = await route.handler(req);
    return reply instanceof Response ? reply : Response.json(reply);
  };
}

// ---------- IMAP and SMTP ----------

interface StoredMessage {
  uid: number;
  raw: Buffer;
  envelope: { messageId?: string; inReplyTo?: string; from: object[]; to: object[]; cc: object[] };
}

interface Folder {
  uidValidity: bigint;
  uidNext: number;
  messages: StoredMessage[];
}

/** One mail provider with IMAP mailboxes (INBOX and Sent) and SMTP, sharing the same user names and passwords. */
export class FakeMailServer {
  private passwords = new Map<string, string>();
  private boxes = new Map<string, Map<string, Folder>>();
  imapConnections: ImapFlowOptions[] = [];
  /** Transports created: the relay URL, or the settings of a user's server. */
  transports: (string | SmtpOptions)[] = [];
  sent: { options: string | SmtpOptions; from: string; to: string[]; raw: Buffer }[] = [];
  /** Messages downloaded in full, as `user:folder/uid`. */
  downloads: string[] = [];
  /** Accept APPENDs without storing them (the provider files its own copy, see `deliver`). */
  dropAppends = false;
  /** Thrown by the next SMTP sends while set. */
  sendError: unknown = null;

  addUser(user: string, password: string): void {
    this.passwords.set(user, password);
    this.boxes.set(user, new Map(['INBOX', 'Sent'].map((path) => [path, { uidValidity: 7n, uidNext: 1, messages: [] }])));
  }

  setPassword(user: string, password: string): void {
    this.passwords.set(user, password);
  }

  folder(user: string, path: string): Folder {
    const folder = this.boxes.get(user)?.get(path);
    if (!folder) throw new Error(`No folder ${path} for ${user}`);
    return folder;
  }

  async deliver(user: string, path: string, raw: Buffer): Promise<number> {
    const email = await PostalMime.parse(raw);
    const folder = this.folder(user, path);
    const uid = folder.uidNext++;
    folder.messages.push({
      uid,
      raw,
      envelope: { messageId: email.messageId, inReplyTo: email.inReplyTo, from: email.from ? [email.from] : [], to: email.to ?? [], cc: email.cc ?? [] },
    });
    return uid;
  }

  private authFailed(user: string | undefined, pass: string | undefined): boolean {
    return !user || this.passwords.get(user) !== pass;
  }

  imap = (options: ImapFlowOptions): ImapClient => {
    this.imapConnections.push(options);
    const server = this;
    const user = options.auth?.user ?? '';
    let open: Folder | null = null;
    let openPath = '';
    const client = {
      mailbox: false as false | { path: string; uidValidity: bigint; uidNext: number },
      on: () => client,
      async connect() {
        if (server.authFailed(user, options.auth?.pass)) throw Object.assign(new Error('Invalid credentials (Failure)'), { authenticationFailed: true });
      },
      async logout() {},
      close() {},
      async list() {
        return [{ path: 'INBOX' }, { path: 'Sent', specialUse: '\\Sent' }];
      },
      async getMailboxLock(path: string) {
        open = server.folder(user, path);
        openPath = path;
        client.mailbox = { path, uidValidity: open.uidValidity, uidNext: open.uidNext };
        return { path, release: () => (client.mailbox = false) };
      },
      async search(query: { since?: Date; uid?: string }) {
        const uids = open!.messages.map((m) => m.uid);
        if (!query.uid) return uids;
        const from = Number(query.uid.split(':')[0]);
        const found = uids.filter((u) => u >= from);
        // Like a real server, "N:*" matches the highest UID even when it is below N.
        return found.length || !uids.length ? found : [Math.max(...uids)];
      },
      async *fetch(range: string) {
        const wanted = new Set(range.split(',').map(Number));
        for (const m of open!.messages) if (wanted.has(m.uid)) yield { uid: m.uid, envelope: m.envelope };
      },
      async fetchOne(uid: string) {
        const m = open!.messages.find((x) => x.uid === Number(uid));
        if (!m) return false;
        server.downloads.push(`${user}:${openPath}/${m.uid}`);
        return { uid: m.uid, source: m.raw };
      },
      async append(path: string, raw: Buffer) {
        if (!server.dropAppends) await server.deliver(user, path, raw);
        return { destination: path };
      },
    };
    return client as unknown as ImapClient;
  };

  transport = (options: string | SmtpOptions): MailTransport => {
    this.transports.push(options);
    const check = () => {
      if (typeof options !== 'string' && this.authFailed(options.auth?.user, options.auth?.pass)) {
        throw Object.assign(new Error('Invalid login: 535 5.7.8 Authentication failed'), { code: 'EAUTH', responseCode: 535 });
      }
    };
    return {
      sendMail: async ({ envelope, raw }) => {
        check();
        if (this.sendError) throw this.sendError;
        this.sent.push({ options, from: envelope.from, to: envelope.to, raw });
        return {};
      },
      verify: async () => {
        check();
        return true;
      },
      close() {},
    };
  };
}

/** A plain RFC 822 message. */
export function rfc822(m: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  date?: Date;
  headers?: string[];
  text?: string;
  attachment?: { name: string; type: string; content: string };
}): Buffer {
  const head = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    ...(m.cc ? [`Cc: ${m.cc}`] : []),
    `Subject: ${m.subject}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`] : []),
    `Date: ${(m.date ?? new Date()).toUTCString()}`,
    'MIME-Version: 1.0',
    ...(m.headers ?? []),
  ];
  const text = m.text ?? 'Hello';
  if (!m.attachment) return Buffer.from([...head, 'Content-Type: text/plain; charset=utf-8', '', text, ''].join('\r\n'));
  const b = 'part-boundary-42';
  const a = m.attachment;
  return Buffer.from(
    [
      ...head,
      `Content-Type: multipart/mixed; boundary="${b}"`,
      '',
      `--${b}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      `--${b}`,
      `Content-Type: ${a.type}; name="${a.name}"`,
      `Content-Disposition: attachment; filename="${a.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      b64(a.content),
      `--${b}--`,
      '',
    ].join('\r\n'),
  );
}

// ---------- calendar subscriptions ----------

/** A local web server for calendar subscription URLs. */
export async function startWebServer(): Promise<{
  base: string;
  set(path: string, body: string, init?: { status?: number; headers?: Record<string, string> }): void;
  close(): Promise<void>;
}> {
  const pages = new Map<string, { body: string; status: number; headers: Record<string, string> }>();
  const server = http.createServer((req, res) => {
    const page = pages.get(req.url ?? '');
    res.writeHead(page?.status ?? 404, page?.headers ?? {});
    res.end(page?.body ?? 'Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    set: (path, body, init = {}) => pages.set(path, { body, status: init.status ?? 200, headers: init.headers ?? { 'content-type': 'text/calendar' } }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------- Twilio webhooks ----------

/** Posts a webhook the way Twilio does: a form body signed with the account's auth token. */
export function twilioPost(app: FastifyInstance, url: string, form: Record<string, string>, signature?: string | null) {
  const sig = signature === undefined ? twilioSignature('twilio-token', `https://crm.example.com${url}`, form) : signature;
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(sig ? { 'x-twilio-signature': sig } : {}) },
    payload: new URLSearchParams(form).toString(),
  });
}

import type { ConnectedAccountSettings } from '@titoforce/shared';
import type { FetchMessageObject } from 'imapflow';
import { AppError, badRequest } from '../util.ts';
import type { PasswordCredentials, SyncState } from './accounts.ts';
import { flattenAddresses, normalizeMessageId } from './mime.ts';
import { mailEndpoint } from './net.ts';
import { errorMessage, ReconnectRequired } from './oauth.ts';
import { type Envelope, FIRST_SYNC_DAYS, type ImapClient, type ImapFactory, type MailFolder, type MailSink, type MailTransport, type TransportFactory } from './types.ts';

type ServerSettings = Pick<ConnectedAccountSettings, 'imapHost' | 'imapPort' | 'imapSecure' | 'smtpHost' | 'smtpPort' | 'smtpSecure' | 'username'>;

/** Turns library errors into messages a user can act on. */
export function mailServerError(kind: 'IMAP' | 'SMTP', err: unknown, testing: boolean): AppError {
  if (err instanceof AppError) return err;
  const e = err as { authenticationFailed?: boolean; responseCode?: number; code?: string; responseText?: string };
  const authFailed = e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535;
  if (authFailed) {
    const msg = `The ${kind} server rejected the username or password`;
    return testing ? badRequest(msg) : new ReconnectRequired(`${msg}. Update the password in Settings.`);
  }
  const detail = (e.responseText || errorMessage(err)).split(/\r?\n/)[0]!.trim().slice(0, 200);
  return testing ? badRequest(`Could not connect to the ${kind} server: ${detail}`) : new AppError(502, 'mail_server_error', `${kind} error: ${detail}`);
}

/** Connects and signs in to the account's IMAP server (the host is checked against private networks first). */
export async function openImap(factory: ImapFactory, s: ServerSettings, creds: PasswordCredentials, allowPrivate: boolean, testing = false): Promise<ImapClient> {
  if (!s.imapHost || !s.imapPort || !s.username) throw badRequest('IMAP server settings are incomplete');
  const ep = await mailEndpoint('imap', s.imapHost, s.imapPort, allowPrivate);
  const secure = s.imapSecure !== false;
  const client = factory({
    host: ep.address,
    port: s.imapPort,
    secure,
    servername: ep.servername,
    // Passwords never cross the internet in cleartext.
    doSTARTTLS: secure ? undefined : allowPrivate ? undefined : true,
    auth: { user: s.username, pass: creds.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    disableAutoIdle: true,
  });
  // Connection errors are reported through the pending command; an unhandled 'error' event would crash the process.
  client.on('error', () => {});
  try {
    await client.connect();
  } catch (err) {
    client.close();
    throw mailServerError('IMAP', err, testing);
  }
  return client;
}

export async function closeImap(client: ImapClient): Promise<void> {
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

/** SMTP transport for the account's own server. */
export async function smtpTransport(factory: TransportFactory, s: ServerSettings, creds: PasswordCredentials, allowPrivate: boolean): Promise<MailTransport> {
  if (!s.smtpHost || !s.smtpPort || !s.username) throw badRequest('SMTP server settings are incomplete');
  const ep = await mailEndpoint('smtp', s.smtpHost, s.smtpPort, allowPrivate);
  const secure = s.smtpSecure !== false;
  return factory({
    host: ep.address,
    port: s.smtpPort,
    secure,
    servername: ep.servername,
    requireTLS: !secure && !allowPrivate,
    auth: { user: s.username, pass: creds.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

function toEnvelope(msg: FetchMessageObject): Envelope {
  const e = msg.envelope;
  const list = (a: { name?: string; address?: string }[] | undefined) => flattenAddresses((a ?? []).map((x) => ({ name: x.name ?? '', address: x.address ?? '' }))).map((x) => x.address);
  return { messageId: normalizeMessageId(e?.messageId), inReplyTo: normalizeMessageId(e?.inReplyTo), from: list(e?.from), to: list(e?.to), cc: list(e?.cc) };
}

async function sentFolder(client: ImapClient): Promise<string | null> {
  const boxes = await client.list();
  return boxes.find((b) => b.specialUse === '\\Sent')?.path ?? null;
}

/**
 * Reads new messages from INBOX and the Sent folder. Each folder keeps a UID cursor tied to its UIDVALIDITY;
 * the first sync looks back FIRST_SYNC_DAYS days. Only messages the sink wants are downloaded in full.
 */
export async function syncImap(client: ImapClient, state: SyncState, sink: MailSink, budget: number): Promise<SyncState> {
  const sent = await sentFolder(client);
  const folders: { path: string; kind: MailFolder }[] = [{ path: 'INBOX', kind: 'inbox' }, ...(sent ? [{ path: sent, kind: 'sent' as const }] : [])];
  const cursors = { ...state.imap };
  for (const folder of folders) {
    if (budget <= 0) break;
    const lock = await client.getMailboxLock(folder.path, { readOnly: true });
    try {
      const box = client.mailbox;
      if (!box) continue;
      const validity = String(box.uidValidity);
      // Captured before searching: anything arriving later gets a higher UID and is read next time.
      const uidNextAtOpen = Number(box.uidNext) || 0;
      const cursor = cursors[folder.path]?.uidValidity === validity ? cursors[folder.path]! : null;
      const found = cursor
        ? ((await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > cursor.lastUid)
        : (await client.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000) }, { uid: true })) || [];
      const batch = [...found].sort((a, b) => a - b).slice(0, budget);
      budget -= batch.length;
      let lastUid = cursor?.lastUid ?? 0;
      if (batch.length) {
        // Collect envelopes first: no other command may run while a FETCH is streaming.
        const headers: FetchMessageObject[] = [];
        for await (const msg of client.fetch(batch.join(','), { uid: true, envelope: true }, { uid: true })) headers.push(msg);
        headers.sort((a, b) => a.uid - b.uid);
        for (const msg of headers) {
          if (await sink.wants(toEnvelope(msg), folder.kind)) {
            const full = await client.fetchOne(String(msg.uid), { uid: true, source: true }, { uid: true });
            if (full && full.source) await sink.ingest(full.source, folder.kind);
          }
          lastUid = Math.max(lastUid, msg.uid);
        }
      }
      if (found.length === batch.length) lastUid = Math.max(lastUid, uidNextAtOpen - 1);
      cursors[folder.path] = { uidValidity: validity, lastUid };
    } finally {
      lock.release();
    }
  }
  return { ...state, imap: cursors };
}

/** Best effort: puts a copy of a message sent over SMTP into the mailbox's Sent folder. */
export async function appendToSent(client: ImapClient, raw: Buffer): Promise<void> {
  const path = await sentFolder(client);
  if (path) await client.append(path, raw, ['\\Seen']);
}

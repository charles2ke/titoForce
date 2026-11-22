import type { SyncState } from './accounts.ts';
import { headerAddresses, normalizeMessageId } from './mime.ts';
import { ProviderError, providerFetch, providerJson } from './oauth.ts';
import { type CalendarEvent, type EventInput, FIRST_SYNC_DAYS, type MailFolder, type MailSink } from './types.ts';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SKIP_LABELS = ['SPAM', 'TRASH', 'DRAFT', 'CHAT'];
const SKIP_QUERY = '-in:spam -in:trash -in:drafts -in:chats';
const ENVELOPE_HEADERS = ['From', 'To', 'Cc', 'Message-ID', 'In-Reply-To'].map((h) => `metadataHeaders=${h}`).join('&');

interface GmailMessage {
  id: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
  raw?: string;
}

const header = (m: GmailMessage, name: string): string | null => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? null;

/** Sends raw RFC 822 bytes; returns the Message-ID Gmail kept (it may assign its own). */
export async function gmailSend(f: typeof fetch, token: string, raw: Buffer): Promise<string | null> {
  const sent = await providerJson<{ id: string }>(f, 'google', 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
    method: 'POST',
    token,
    body: raw,
    headers: { 'content-type': 'message/rfc822' },
    timeoutMs: 120_000,
  });
  try {
    const meta = await providerJson<GmailMessage>(f, 'google', `${GMAIL}/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-ID`, { token });
    return normalizeMessageId(header(meta, 'message-id'));
  } catch {
    return null;
  }
}

/** Ids of messages matching a Gmail search, oldest first (at most `max`, the most recent ones). */
async function listIds(f: typeof fetch, token: string, q: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GMAIL}/messages`);
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', String(Math.min(100, max - ids.length)));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await providerJson<{ messages?: { id: string }[]; nextPageToken?: string }>(f, 'google', url.toString(), { token });
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max).reverse();
}

/** Ids of messages added since a history id, oldest first. */
async function historyIds(f: typeof fetch, token: string, startHistoryId: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GMAIL}/history`);
    url.searchParams.set('startHistoryId', startHistoryId);
    url.searchParams.set('historyTypes', 'messageAdded');
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await providerJson<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string }>(f, 'google', url.toString(), { token });
    for (const h of page.history ?? []) for (const m of h.messagesAdded ?? []) if (!ids.includes(m.message.id)) ids.push(m.message.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < 5000);
  return ids;
}

/**
 * Reads new Gmail messages: the first sync lists recent mail, later syncs follow the history id. Envelopes are read
 * first; only messages the sink wants are downloaded in full.
 */
export async function syncGmail(f: typeof fetch, token: string, state: SyncState, sink: MailSink, budget: number): Promise<SyncState> {
  const profile = await providerJson<{ historyId: string }>(f, 'google', `${GMAIL}/profile`, { token });
  let ids: string[];
  let next: SyncState['gmail'] = { historyId: profile.historyId };
  const cursor = state.gmail;
  if (cursor?.historyId) {
    try {
      const all = await historyIds(f, token, cursor.historyId);
      const offset = cursor.offset ?? 0;
      ids = all.slice(offset, offset + budget);
      if (offset + ids.length < all.length) next = { historyId: cursor.historyId, offset: offset + ids.length };
    } catch (err) {
      // Gmail keeps history for at least a week, but sometimes only for hours; then fall back to a search since the last sync.
      if (!(err instanceof ProviderError && err.upstream === 404)) throw err;
      const since = Math.floor((Date.parse(state.mailSyncedAt ?? '') || Date.now() - FIRST_SYNC_DAYS * 86_400_000) / 1000) - 3600;
      ids = await listIds(f, token, `after:${since} ${SKIP_QUERY}`, budget);
    }
  } else {
    ids = await listIds(f, token, `newer_than:${FIRST_SYNC_DAYS}d ${SKIP_QUERY}`, budget);
  }

  for (const id of ids) {
    let meta: GmailMessage;
    try {
      meta = await providerJson<GmailMessage>(f, 'google', `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&${ENVELOPE_HEADERS}`, { token });
    } catch (err) {
      if (err instanceof ProviderError && err.upstream === 404) continue; // deleted since
      throw err;
    }
    const labels = meta.labelIds ?? [];
    if (labels.some((l) => SKIP_LABELS.includes(l))) continue;
    const folder: MailFolder = labels.includes('SENT') ? 'sent' : 'inbox';
    const env = {
      messageId: normalizeMessageId(header(meta, 'message-id')),
      inReplyTo: normalizeMessageId(header(meta, 'in-reply-to')),
      from: headerAddresses(header(meta, 'from')),
      to: headerAddresses(header(meta, 'to')),
      cc: headerAddresses(header(meta, 'cc')),
    };
    if (!(await sink.wants(env, folder))) continue;
    const full = await providerJson<GmailMessage>(f, 'google', `${GMAIL}/messages/${encodeURIComponent(id)}?format=raw`, { token, timeoutMs: 60_000 });
    if (full.raw) await sink.ingest(Buffer.from(full.raw, 'base64url'), folder);
  }
  return { ...state, gmail: next };
}

// ---------- Google Calendar ----------

interface GoogleTime {
  dateTime?: string;
  date?: string;
}

interface GoogleEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean }[];
  organizer?: { email?: string };
  recurringEventId?: string;
  originalStartTime?: GoogleTime;
}

const googleTime = (t: GoogleTime | undefined): string | null => (t?.dateTime ? new Date(t.dateTime).toISOString() : (t?.date ?? null));

function fromGoogle(e: GoogleEvent): CalendarEvent | null {
  const start = googleTime(e.start);
  if (!start) return null; // cancelled occurrences can come without details
  const occurrence = e.recurringEventId ? googleTime(e.originalStartTime) : null;
  return {
    key: e.iCalUID ? (occurrence ? `${e.iCalUID}|${occurrence}` : e.iCalUID) : `google:${e.id}`,
    providerId: e.id,
    title: e.summary?.trim() || '(no title)',
    start,
    end: googleTime(e.end),
    allDay: !e.start?.dateTime,
    location: e.location?.trim() || null,
    description: e.description ?? null,
    organizer: e.organizer?.email?.toLowerCase() ?? null,
    attendees: (e.attendees ?? []).filter((a) => a.email && !a.resource).map((a) => ({ email: a.email!.toLowerCase(), name: a.displayName ?? null })),
    cancelled: e.status === 'cancelled',
    declined: (e.attendees ?? []).some((a) => a.self && a.responseStatus === 'declined'),
  };
}

/** Events (recurring ones expanded) between two dates in the primary calendar. */
export async function googleEvents(f: typeof fetch, token: string, from: Date, to: Date, max = 2000): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(CALENDAR);
    url.searchParams.set('timeMin', from.toISOString());
    url.searchParams.set('timeMax', to.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('showDeleted', 'true');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await providerJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(f, 'google', url.toString(), { token });
    for (const e of page.items ?? []) {
      const ev = fromGoogle(e);
      if (ev) out.push(ev);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < max);
  return out;
}

const googleBody = (ev: EventInput) => ({
  summary: ev.title,
  description: ev.description ?? undefined,
  location: ev.location ?? undefined,
  start: { dateTime: ev.start },
  end: { dateTime: ev.end },
  attendees: ev.attendees.map((email) => ({ email })),
});

const sendUpdates = (ev: { sendInvites: boolean }) => `sendUpdates=${ev.sendInvites ? 'all' : 'none'}`;

export async function googleCreateEvent(f: typeof fetch, token: string, ev: EventInput): Promise<{ providerId: string; key: string }> {
  const created = await providerJson<GoogleEvent>(f, 'google', `${CALENDAR}?${sendUpdates(ev)}`, { method: 'POST', token, json: googleBody(ev) });
  return { providerId: created.id, key: created.iCalUID ?? `google:${created.id}` };
}

export async function googleUpdateEvent(f: typeof fetch, token: string, providerId: string, ev: EventInput): Promise<void> {
  await providerJson(f, 'google', `${CALENDAR}/${encodeURIComponent(providerId)}?${sendUpdates(ev)}`, { method: 'PATCH', token, json: googleBody(ev) });
}

export async function googleDeleteEvent(f: typeof fetch, token: string, providerId: string, sendInvites: boolean): Promise<void> {
  try {
    await providerFetch(f, 'google', `${CALENDAR}/${encodeURIComponent(providerId)}?${sendUpdates({ sendInvites })}`, { method: 'DELETE', token });
  } catch (err) {
    if (!(err instanceof ProviderError && (err.upstream === 404 || err.upstream === 410))) throw err;
  }
}

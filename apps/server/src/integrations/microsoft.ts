import type { SyncState } from './accounts.ts';
import { normalizeMessageId } from './mime.ts';
import { ProviderError, providerFetch, providerJson } from './oauth.ts';
import { type CalendarEvent, type EventInput, FIRST_SYNC_DAYS, type MailFolder, type MailSink } from './types.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
/**
 * Microsoft documents no size limit for MIME sendMail. Other single Graph requests that carry files stop at 3–4 MB,
 * so the base64-encoded message is kept under 4 MB (not checked against a live tenant).
 */
export const GRAPH_MAX_MIME_BYTES = 2_900_000;

/** Sends a complete MIME message (Graph keeps a copy in Sent Items). */
export async function graphSend(f: typeof fetch, token: string, raw: Buffer): Promise<void> {
  await providerFetch(f, 'microsoft', `${GRAPH}/me/sendMail`, {
    method: 'POST',
    token,
    body: raw.toString('base64'),
    headers: { 'content-type': 'text/plain' },
    timeoutMs: 120_000,
  });
}

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  '@removed'?: unknown;
  internetMessageId?: string;
  isDraft?: boolean;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
}

interface DeltaPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

const addresses = (list: GraphAddress[] | undefined): string[] =>
  (list ?? []).map((a) => a.emailAddress?.address?.trim().toLowerCase() ?? '').filter((a) => a.includes('@'));

const FOLDERS: { id: string; kind: MailFolder }[] = [
  { id: 'inbox', kind: 'inbox' },
  { id: 'sentitems', kind: 'sent' },
];

function initialDeltaUrl(folder: string, since: Date): string {
  const url = new URL(`${GRAPH}/me/mailFolders/${folder}/messages/delta`);
  url.searchParams.set('$select', 'internetMessageId,from,toRecipients,ccRecipients,isDraft,receivedDateTime');
  url.searchParams.set('$filter', `receivedDateTime ge ${since.toISOString().replace(/\.\d{3}Z$/, 'Z')}`);
  return url.toString();
}

/**
 * Follows Graph delta queries over Inbox and Sent Items. The cursor per folder is the next page or delta link;
 * pages are processed whole, so a run may go slightly over budget.
 */
export async function syncGraphMail(f: typeof fetch, token: string, state: SyncState, sink: MailSink, budget: number): Promise<SyncState> {
  const cursors = { ...state.graph };
  const fallbackSince = new Date((Date.parse(state.mailSyncedAt ?? '') || Date.now() - FIRST_SYNC_DAYS * 86_400_000) - 3_600_000);
  for (const folder of FOLDERS) {
    let link = cursors[folder.id] ?? initialDeltaUrl(folder.id, new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000));
    while (budget > 0) {
      let page: DeltaPage<GraphMessage>;
      try {
        page = await providerJson<DeltaPage<GraphMessage>>(f, 'microsoft', link, { token, headers: { prefer: 'odata.maxpagesize=50' } });
      } catch (err) {
        // The delta link expired or was reset (410, or syncStateNotFound): start over from shortly before the last sync.
        const expired = err instanceof ProviderError && (err.upstream === 410 || (err.upstream >= 400 && err.upstream < 500 && err.upstreamCode === 'syncStateNotFound'));
        if (expired && cursors[folder.id]) {
          delete cursors[folder.id];
          link = initialDeltaUrl(folder.id, fallbackSince);
          continue;
        }
        throw err;
      }
      for (const m of page.value ?? []) {
        if (m['@removed'] || m.isDraft) continue;
        budget--;
        const env = {
          messageId: normalizeMessageId(m.internetMessageId),
          // The delta does not return In-Reply-To, so before the download a reply is kept only when a contact
          // takes part (or unmatched mail is wanted); replies to logged threads from unknown senders are skipped.
          inReplyTo: null,
          from: addresses(m.from ? [m.from] : []),
          to: addresses(m.toRecipients),
          cc: addresses(m.ccRecipients),
        };
        if (!(await sink.wants(env, folder.kind))) continue;
        let raw: Buffer;
        try {
          const res = await providerFetch(f, 'microsoft', `${GRAPH}/me/messages/${encodeURIComponent(m.id)}/$value`, { token, timeoutMs: 60_000, headers: { accept: '*/*' } });
          raw = Buffer.from(await res.arrayBuffer());
        } catch (err) {
          if (err instanceof ProviderError && err.upstream === 404) continue; // deleted since
          throw err;
        }
        await sink.ingest(raw, folder.kind);
      }
      const next = page['@odata.nextLink'];
      const delta = page['@odata.deltaLink'];
      if (next) {
        link = next;
        cursors[folder.id] = next;
        continue;
      }
      if (delta) cursors[folder.id] = delta;
      break;
    }
  }
  return { ...state, graph: cursors };
}

// ---------- Calendar ----------

interface GraphTime {
  dateTime?: string;
  timeZone?: string;
}

interface GraphEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  start?: GraphTime;
  end?: GraphTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  organizer?: GraphAddress;
  attendees?: (GraphAddress & { type?: string })[];
  responseStatus?: { response?: string };
}

/** Graph returns times in the zone requested with the Prefer header (UTC), without an offset. */
function graphTime(t: GraphTime | undefined, allDay: boolean): string | null {
  if (!t?.dateTime) return null;
  if (allDay) return t.dateTime.slice(0, 10);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function fromGraph(e: GraphEvent): CalendarEvent | null {
  const allDay = !!e.isAllDay;
  const start = graphTime(e.start, allDay);
  if (!start) return null;
  const description = e.body?.contentType === 'text' ? (e.body.content ?? null) : (e.bodyPreview ?? null);
  return {
    key: e.iCalUId || `microsoft:${e.id}`,
    providerId: e.id,
    title: e.subject?.trim() || '(no title)',
    start,
    end: graphTime(e.end, allDay),
    allDay,
    location: e.location?.displayName?.trim() || null,
    description: description?.trim() || null,
    organizer: e.organizer?.emailAddress?.address?.toLowerCase() ?? null,
    attendees: (e.attendees ?? [])
      .filter((a) => a.type !== 'resource' && a.emailAddress?.address)
      .map((a) => ({ email: a.emailAddress!.address!.toLowerCase(), name: a.emailAddress?.name ?? null })),
    cancelled: !!e.isCancelled,
    declined: e.responseStatus?.response === 'declined',
  };
}

/** Events (recurring ones expanded) between two dates in the default calendar. */
export async function graphEvents(f: typeof fetch, token: string, from: Date, to: Date, max = 2000): Promise<CalendarEvent[]> {
  const url = new URL(`${GRAPH}/me/calendarView`);
  url.searchParams.set('startDateTime', from.toISOString());
  url.searchParams.set('endDateTime', to.toISOString());
  url.searchParams.set('$select', 'iCalUId,subject,body,bodyPreview,start,end,isAllDay,isCancelled,location,organizer,attendees,responseStatus');
  url.searchParams.set('$top', '100');
  const out: CalendarEvent[] = [];
  let link: string | undefined = url.toString();
  while (link && out.length < max) {
    const page: DeltaPage<GraphEvent> = await providerJson<DeltaPage<GraphEvent>>(f, 'microsoft', link, {
      token,
      headers: { prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' },
    });
    for (const e of page.value ?? []) {
      const ev = fromGraph(e);
      if (ev) out.push(ev);
    }
    link = page['@odata.nextLink'];
  }
  return out;
}

function graphBody(ev: EventInput, withAttendees: boolean) {
  return {
    subject: ev.title,
    body: { contentType: 'text', content: ev.description ?? '' },
    start: { dateTime: ev.start.replace(/Z$/, ''), timeZone: 'UTC' },
    end: { dateTime: ev.end.replace(/Z$/, ''), timeZone: 'UTC' },
    location: { displayName: ev.location ?? '' },
    // Outlook emails invitations whenever an event has attendees.
    ...(withAttendees ? { attendees: ev.attendees.map((address) => ({ emailAddress: { address }, type: 'required' })) } : {}),
  };
}

export async function graphCreateEvent(f: typeof fetch, token: string, ev: EventInput): Promise<{ providerId: string; key: string }> {
  const created = await providerJson<GraphEvent>(f, 'microsoft', `${GRAPH}/me/events`, { method: 'POST', token, json: graphBody(ev, ev.sendInvites) });
  return { providerId: created.id, key: created.iCalUId || `microsoft:${created.id}` };
}

export async function graphUpdateEvent(f: typeof fetch, token: string, providerId: string, ev: EventInput): Promise<void> {
  await providerJson(f, 'microsoft', `${GRAPH}/me/events/${encodeURIComponent(providerId)}`, { method: 'PATCH', token, json: graphBody(ev, ev.sendInvites) });
}

/** Deleting an event from the organizer's calendar also sends attendees a cancellation (when it has any). */
export async function graphDeleteEvent(f: typeof fetch, token: string, providerId: string): Promise<void> {
  try {
    await providerFetch(f, 'microsoft', `${GRAPH}/me/events/${encodeURIComponent(providerId)}`, { method: 'DELETE', token });
  } catch (err) {
    if (!(err instanceof ProviderError && (err.upstream === 404 || err.upstream === 410))) throw err;
  }
}

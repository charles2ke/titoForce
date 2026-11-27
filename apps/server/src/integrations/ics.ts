import ICAL from 'ical.js';
import { badRequest } from '../util.ts';
import type { CalendarEvent } from './types.ts';

/** Occurrences expanded per recurring series at most (a daily series over 50 years). */
const MAX_ITERATIONS = 20_000;

type Time = InstanceType<typeof ICAL.Time>;
type Event = InstanceType<typeof ICAL.Event>;
type Component = InstanceType<typeof ICAL.Component>;

const ianaZones = new Map<string, boolean>();
function isIanaZone(tz: string): boolean {
  let known = ianaZones.get(tz);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      known = true;
    } catch {
      known = false;
    }
    if (ianaZones.size < 500) ianaZones.set(tz, known);
  }
  return known;
}

/** Milliseconds a zone is ahead of UTC at an instant. */
function zoneOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(ms / 1000) * 1000;
}

/** The instant of a wall-clock time in a zone. */
function zonedToUtc(t: Time, tz: string): number {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const first = wall - zoneOffset(wall, tz);
  const second = wall - zoneOffset(first, tz);
  return second;
}

/**
 * Epoch milliseconds of a time. Times whose zone has no definition in the file (and floating times) would otherwise
 * be read in the server's zone: named IANA zones are resolved with Intl, anything else is read as UTC.
 */
function epoch(t: Time, tzid: string | null): number {
  if (t.isDate) return Date.UTC(t.year, t.month - 1, t.day);
  if (t.zone === ICAL.Timezone.localTimezone) {
    if (tzid && isIanaZone(tzid)) return zonedToUtc(t, tzid);
    return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  }
  return t.toJSDate().getTime();
}

const isoDate = (t: Time): string => `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
const timeValue = (t: Time, tzid: string | null): string => (t.isDate ? isoDate(t) : new Date(epoch(t, tzid)).toISOString());

const mailto = (value: unknown): string | null => {
  const s = String(value ?? '')
    .trim()
    .replace(/^mailto:/i, '')
    .toLowerCase();
  return s.includes('@') ? s : null;
};

const tzidOf = (item: Event, prop: 'dtstart' | 'dtend'): string | null => {
  const p = item.component.getFirstProperty(prop) ?? item.component.getFirstProperty('dtstart');
  const tz = p?.getParameter('tzid');
  return typeof tz === 'string' ? tz : null;
};

function toEvent(item: Event, key: string, start: Time, end: Time | null, self: Set<string>): CalendarEvent {
  const attendees = item.attendees
    .filter((p) => !['ROOM', 'RESOURCE'].includes(String(p.getParameter('cutype') ?? '').toUpperCase()))
    .map((p) => ({ email: mailto(p.getFirstValue()), name: (p.getParameter('cn') as string | undefined) ?? null, partstat: String(p.getParameter('partstat') ?? '').toUpperCase() }))
    .filter((a): a is { email: string; name: string | null; partstat: string } => !!a.email);
  return {
    key,
    providerId: null,
    title: item.summary?.trim() || '(no title)',
    start: timeValue(start, tzidOf(item, 'dtstart')),
    end: end ? timeValue(end, tzidOf(item, 'dtend')) : null,
    allDay: start.isDate,
    location: item.location?.trim() || null,
    description: item.description?.trim() || null,
    organizer: mailto(item.organizer),
    attendees: attendees.map(({ email, name }) => ({ email, name })),
    cancelled: String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED',
    declined: attendees.some((a) => self.has(a.email) && a.partstat === 'DECLINED'),
  };
}

export interface IcsWindow {
  from: Date;
  to: Date;
  /** Addresses of the calendar's owner, to tell whether they declined. */
  self: string[];
  max?: number;
}

function parseCalendar(text: string): Component {
  const jcal = ICAL.parse(text) as unknown;
  const list = (Array.isArray(jcal) && Array.isArray(jcal[0]) ? jcal : [jcal]) as unknown[];
  const cal = list.map((j) => new ICAL.Component(j as never)).find((c) => c.name === 'vcalendar');
  if (!cal) throw new Error('no VCALENDAR');
  return cal;
}

/**
 * ical.js rejects a whole file when one value is malformed (e.g. an unknown RRULE frequency). Then the calendar
 * header and time zones are parsed alone and each event separately, skipping the broken ones.
 */
function parseLeniently(text: string): Component {
  const first = text.search(/^BEGIN:VEVENT/im);
  if (first < 0) throw new Error('no events');
  const root = parseCalendar(`${text.slice(0, first)}\r\nEND:VCALENDAR\r\n`);
  for (const block of text.match(/^BEGIN:VEVENT\r?\n[\s\S]*?^END:VEVENT\b/gim) ?? []) {
    try {
      const event = parseCalendar(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${block}\r\nEND:VCALENDAR\r\n`).getFirstSubcomponent('vevent');
      if (event) root.addSubcomponent(event);
    } catch {
      // skipped
    }
  }
  return root;
}

/** Parses an iCalendar file into the events overlapping a window, with recurring events expanded. */
export function parseIcs(text: string, window: IcsWindow): CalendarEvent[] {
  let root: Component;
  try {
    root = parseCalendar(text);
  } catch {
    try {
      root = parseLeniently(text);
    } catch {
      throw badRequest('The address did not return an iCalendar (.ics) file');
    }
  }
  const from = window.from.getTime();
  const to = window.to.getTime();
  const max = window.max ?? 2000;
  const self = new Set(window.self.map((s) => s.toLowerCase()));
  const masters = new Map<string, Component>();
  const exceptions = new Map<string, Component[]>();
  for (const ve of root.getAllSubcomponents('vevent')) {
    const uid = String(ve.getFirstPropertyValue('uid') ?? '');
    if (!uid) continue;
    if (ve.hasProperty('recurrence-id')) exceptions.set(uid, [...(exceptions.get(uid) ?? []), ve]);
    else masters.set(uid, ve);
  }

  const out: CalendarEvent[] = [];
  const overlaps = (item: Event, start: Time, end: Time | null) => {
    const s = epoch(start, tzidOf(item, 'dtstart'));
    const e = end ? epoch(end, tzidOf(item, 'dtend')) : s;
    return s <= to && e >= from;
  };
  for (const [uid, ve] of masters) {
    if (out.length >= max) break;
    let event: Event;
    try {
      event = new ICAL.Event(ve);
      if (!event.isRecurring()) {
        if (event.startDate && overlaps(event, event.startDate, event.endDate)) out.push(toEvent(event, uid, event.startDate, event.endDate, self));
        continue;
      }
      for (const ex of exceptions.get(uid) ?? []) event.relateException(ex);
      exceptions.delete(uid);
      const it = event.iterator();
      for (let i = 0; i < MAX_ITERATIONS && out.length < max; i++) {
        const next = it.next() as Time | undefined | null;
        if (!next) break;
        if (epoch(next, tzidOf(event, 'dtstart')) > to) break;
        const occ = event.getOccurrenceDetails(next);
        if (!overlaps(occ.item, occ.startDate, occ.endDate)) continue;
        const key = `${uid}|${timeValue(occ.recurrenceId, tzidOf(event, 'dtstart'))}`;
        out.push(toEvent(occ.item, key, occ.startDate, occ.endDate, self));
      }
    } catch {
      // One malformed event (e.g. an invalid RRULE) does not spoil the rest of the calendar.
    }
  }
  // Moved or cancelled occurrences whose series is not in the file.
  for (const [uid, list] of exceptions) {
    for (const ve of list) {
      if (out.length >= max) break;
      try {
        const event = new ICAL.Event(ve);
        if (!event.startDate || !overlaps(event, event.startDate, event.endDate)) continue;
        out.push(toEvent(event, `${uid}|${timeValue(event.recurrenceId, tzidOf(event, 'dtstart'))}`, event.startDate, event.endDate, self));
      } catch {
        // skipped, as above
      }
    }
  }
  return out;
}

// ---------- Feed ----------

export interface FeedEvent {
  uid: string;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day entries. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  url: string;
  updatedAt: string;
  completed: boolean;
}

const escapeText = (value: string): string => value.replace(/\r\n?/g, '\n').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

const utcStamp = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateStamp = (date: string): string => date.slice(0, 10).replace(/-/g, '');
const nextDay = (date: string): string => new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Folds a content line at 75 octets without splitting UTF-8 sequences (RFC 5545 section 3.1). */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** A read-only iCalendar feed for calendar apps to subscribe to. */
export function buildIcsFeed(name: string, events: FeedEvent[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//titoForce//CRM//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];
  const stamp = utcStamp(now.toISOString());
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeText(e.uid)}`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(e.start)}`, `DTEND;VALUE=DATE:${dateStamp(e.end && e.end > e.start ? e.end : nextDay(e.start))}`);
    } else {
      const end = e.end && Date.parse(e.end) > Date.parse(e.start) ? e.end : new Date(Date.parse(e.start) + 30 * 60_000).toISOString();
      lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.completed ? `✓ ${e.title}` : e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    const description = [e.description?.trim(), e.url].filter(Boolean).join('\n\n');
    lines.push(`DESCRIPTION:${escapeText(description)}`, `URL:${e.url}`, `LAST-MODIFIED:${utcStamp(e.updatedAt)}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

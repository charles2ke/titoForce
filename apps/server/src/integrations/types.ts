import type { ImapFlow, ImapFlowOptions } from 'imapflow';

/** How far back the first mail sync of an account reads. */
export const FIRST_SYNC_DAYS = 14;

/** Addresses and threading headers of a message, used to decide whether to download it. */
export interface Envelope {
  messageId: string | null;
  inReplyTo: string | null;
  from: string[];
  to: string[];
  cc: string[];
}

export type MailFolder = 'inbox' | 'sent';
export type IngestOutcome = 'logged' | 'duplicate' | 'skipped';

/** Where provider sync loops hand messages to. */
export interface MailSink {
  wants(env: Envelope, folder: MailFolder): Promise<boolean>;
  ingest(raw: Buffer, folder: MailFolder): Promise<IngestOutcome>;
}

export type ImapClient = Pick<ImapFlow, 'connect' | 'logout' | 'close' | 'list' | 'getMailboxLock' | 'search' | 'fetch' | 'fetchOne' | 'append' | 'mailbox' | 'on'>;
export type ImapFactory = (options: ImapFlowOptions) => ImapClient;

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  servername?: string;
  requireTLS?: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}

/** The part of a nodemailer transport that is used (tests inject fakes). */
export interface MailTransport {
  sendMail(message: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown>;
  verify(): Promise<unknown>;
  close(): void;
}
export type TransportFactory = (options: string | SmtpOptions) => MailTransport;

/** A meeting to create or update in a user's calendar. */
export interface EventInput {
  title: string;
  /** ISO date-times. */
  start: string;
  end: string;
  location: string | null;
  description: string | null;
  attendees: string[];
  /** Email invitations to attendees (Microsoft only adds attendees when invitations are sent). */
  sendInvites: boolean;
}

/** A calendar event from any provider. */
export interface CalendarEvent {
  /** Identity shared across calendars (iCalendar UID, plus the occurrence for recurring events). */
  key: string;
  /** The provider's own event id (Google, Microsoft). */
  providerId: string | null;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day events. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  attendees: { email: string; name: string | null }[];
  cancelled: boolean;
  /** The calendar's owner declined the invitation. */
  declined: boolean;
}

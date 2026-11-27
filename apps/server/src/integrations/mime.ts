import { randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import { type Address, addressParser, type Header } from 'postal-mime';
import { normalizeEmail } from '../platform/contact-points.ts';

/** `<id@host>` form of a Message-ID, or null. */
export function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /<([^<>\s]+)>/.exec(value) ?? /^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(value);
  return m ? `<${m[1]!.slice(0, 900)}>` : null;
}

/** Message-IDs listed in a References or In-Reply-To header. */
export function parseReferences(...values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) for (const m of (v ?? '').matchAll(/<[^<>\s]+>/g)) if (!out.includes(m[0])) out.push(m[0].slice(0, 900));
  return out.slice(-20);
}

export const newMessageId = (fromAddress: string): string => `<${randomUUID()}@${fromAddress.split('@')[1] || 'titoforce.local'}>`;

/** Normalized addresses from parsed address lists (groups flattened, invalid entries dropped). */
export function flattenAddresses(list: Address | Address[] | undefined | null): { address: string; name: string | null }[] {
  const out: { address: string; name: string | null }[] = [];
  const add = (a: Address) => {
    if (a.group) a.group.forEach(add);
    else {
      const address = normalizeEmail(a.address);
      if (address && !out.some((o) => o.address === address)) out.push({ address, name: a.name?.trim() || null });
    }
  };
  for (const a of Array.isArray(list) ? list : list ? [list] : []) add(a);
  return out;
}

/** Addresses in a raw header value such as `"Ann" <ann@example.com>, bob@example.com`. */
export const headerAddresses = (value: string | null | undefined): string[] => flattenAddresses(value ? addressParser(value) : []).map((a) => a.address);

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)([+.-]|@)/i;

/** Newsletters, mailing lists, auto-replies and bounces are not logged. */
export function isAutomated(headers: Header[], from: string): boolean {
  const get = (name: string) => headers.find((h) => h.key.toLowerCase() === name)?.value?.trim().toLowerCase();
  const auto = get('auto-submitted');
  if (auto && auto !== 'no') return true;
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(get('precedence') ?? '')) return true;
  if (get('list-id') || get('list-unsubscribe')) return true;
  return AUTOMATED_SENDER.test(from);
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** Plain text of an HTML body (email HTML is never rendered). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|table)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k]!;
      const code = k.startsWith('#x') ? Number.parseInt(k.slice(2), 16) : k.startsWith('#') ? Number.parseInt(k.slice(1), 10) : Number.NaN;
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    .replace(/[ \t\u00a0]+\n/g, '\n')
    .replace(/[ \t\u00a0]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface OutgoingFile {
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface OutgoingEmail {
  from: { name: string; address: string };
  replyTo?: string | null;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  files: OutgoingFile[];
}

const quoteName = (name: string) => `"${name.replace(/["\\\r\n]/g, '')}"`;

/** RFC 822 bytes of a message. Files are only ever passed as in-memory content (no file or URL access). */
export function buildMime(m: OutgoingEmail): Promise<Buffer> {
  const composer = new MailComposer({
    from: `${quoteName(m.from.name)} <${m.from.address}>`,
    replyTo: m.replyTo ?? undefined,
    to: m.to,
    cc: m.cc.length ? m.cc : undefined,
    subject: m.subject,
    text: m.text,
    messageId: m.messageId,
    date: new Date(),
    inReplyTo: m.inReplyTo ?? undefined,
    references: m.references?.length ? m.references : undefined,
    attachments: m.files.map((f) => ({ filename: f.fileName, contentType: f.contentType, content: f.data })),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return composer.compile().build();
}

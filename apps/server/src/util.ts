import { randomBytes } from 'node:crypto';

export class AppError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const forbidden = (message = 'You do not have permission to perform this action') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Time-sortable, URL-safe id with a readable prefix, e.g. "opp_mi7x0k2a9q3vbn5d8w1z". */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const bytes = randomBytes(11);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % 36];
  return `${prefix}_${time}${rand}`;
}

export const nowIso = (): string => new Date().toISOString();

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** RFC 4180 CSV parser: quoted fields, escaped quotes, embedded newlines, CRLF/LF, optional BOM. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Sliding-window limiter for abuse-prone endpoints (in-memory, per process). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }

  /** True while the key is under the limit; does not count as a hit. */
  allowed(key: string): boolean {
    return this.recent(key, Date.now()).length < this.limit;
  }

  /** Records a hit unless the key is already at the limit; returns whether it was allowed. */
  hit(key: string): boolean {
    const now = Date.now();
    const recent = this.recent(key, now);
    const ok = recent.length < this.limit;
    if (ok) recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [k, times] of this.hits) if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(k);
      if (this.hits.size > 10_000) this.hits.clear();
    }
    return ok;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

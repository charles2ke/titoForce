import { isBlank } from './expression.ts';
import type { FieldType, FilterGroup, FilterRule } from './types.ts';

// ---------- Relative date literals (UTC) ----------

export const DATE_LITERALS = [
  'TODAY',
  'YESTERDAY',
  'TOMORROW',
  'THIS_WEEK',
  'LAST_WEEK',
  'NEXT_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'NEXT_MONTH',
  'THIS_QUARTER',
  'LAST_QUARTER',
  'NEXT_QUARTER',
  'THIS_YEAR',
  'LAST_YEAR',
  'NEXT_YEAR',
] as const;

export interface DateRange {
  /** Inclusive start, YYYY-MM-DD */
  start: string;
  /** Inclusive end, YYYY-MM-DD */
  end: string;
}

const day = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** Resolves values such as TODAY, THIS_MONTH, LAST_N_DAYS:30 to an inclusive date range. */
export function resolveDateLiteral(value: unknown, now: Date = new Date()): DateRange | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const nDays = /^(LAST|NEXT)_N_DAYS:(\d{1,4})$/.exec(v);
  if (nDays) {
    const n = Number(nDays[2]);
    return nDays[1] === 'LAST' ? { start: day(y, m, d - n), end: day(y, m, d) } : { start: day(y, m, d), end: day(y, m, d + n) };
  }
  const weekday = (now.getUTCDay() + 6) % 7; // Monday = 0
  const q = Math.floor(m / 3) * 3;
  switch (v) {
    case 'TODAY':
      return { start: day(y, m, d), end: day(y, m, d) };
    case 'YESTERDAY':
      return { start: day(y, m, d - 1), end: day(y, m, d - 1) };
    case 'TOMORROW':
      return { start: day(y, m, d + 1), end: day(y, m, d + 1) };
    case 'THIS_WEEK':
      return { start: day(y, m, d - weekday), end: day(y, m, d - weekday + 6) };
    case 'LAST_WEEK':
      return { start: day(y, m, d - weekday - 7), end: day(y, m, d - weekday - 1) };
    case 'NEXT_WEEK':
      return { start: day(y, m, d - weekday + 7), end: day(y, m, d - weekday + 13) };
    case 'THIS_MONTH':
      return { start: day(y, m, 1), end: day(y, m + 1, 0) };
    case 'LAST_MONTH':
      return { start: day(y, m - 1, 1), end: day(y, m, 0) };
    case 'NEXT_MONTH':
      return { start: day(y, m + 1, 1), end: day(y, m + 2, 0) };
    case 'THIS_QUARTER':
      return { start: day(y, q, 1), end: day(y, q + 3, 0) };
    case 'LAST_QUARTER':
      return { start: day(y, q - 3, 1), end: day(y, q, 0) };
    case 'NEXT_QUARTER':
      return { start: day(y, q + 3, 1), end: day(y, q + 6, 0) };
    case 'THIS_YEAR':
      return { start: day(y, 0, 1), end: day(y, 11, 31) };
    case 'LAST_YEAR':
      return { start: day(y - 1, 0, 1), end: day(y - 1, 11, 31) };
    case 'NEXT_YEAR':
      return { start: day(y + 1, 0, 1), end: day(y + 1, 11, 31) };
    default:
      return null;
  }
}

/** Upper bound usable for both date (YYYY-MM-DD) and datetime (ISO) string comparison. */
export const endOfDay = (date: string): string => `${date}T23:59:59.999Z`;

// ---------- In-memory filter evaluation (automation conditions, approval entry criteria) ----------

export interface MatchOptions {
  now?: Date;
  currentUserId?: string | null;
  types?: Record<string, FieldType>;
}

const norm = (v: unknown): unknown => (typeof v === 'string' ? v.toLowerCase() : v);

function eqValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (isBlank(a) || isBlank(b)) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a).toLowerCase() === String(b).toLowerCase();
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return norm(a) === norm(b);
}

function cmp(a: unknown, b: unknown): number | null {
  if (isBlank(a) || isBlank(b)) return null;
  if ((typeof a === 'number' || typeof b === 'number') && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) - Number(b);
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function matchesRule(rule: FilterRule, values: Record<string, unknown>, opts: MatchOptions = {}): boolean {
  const actual = values[rule.field];
  let expected = rule.value;
  if (expected === 'CURRENT_USER') expected = opts.currentUserId ?? null;
  const type = opts.types?.[rule.field];

  if (rule.op === 'is_empty') return isBlank(actual);
  if (rule.op === 'is_not_empty') return !isBlank(actual);

  if (Array.isArray(actual) || type === 'multipicklist') {
    const arr = (Array.isArray(actual) ? actual : isBlank(actual) ? [] : [actual]).map(norm);
    const wanted = (Array.isArray(expected) ? expected : [expected]).map(norm);
    switch (rule.op) {
      case 'eq':
      case 'contains':
      case 'in':
        return wanted.some((w) => arr.includes(w));
      case 'neq':
      case 'not_contains':
      case 'not_in':
        return !wanted.some((w) => arr.includes(w));
      default:
        return false;
    }
  }

  const range = (type === undefined || type === 'date' || type === 'datetime') ? resolveDateLiteral(expected, opts.now) : null;
  if (range) {
    if (isBlank(actual)) return rule.op === 'neq';
    const v = String(actual);
    const inRange = v >= range.start && v <= endOfDay(range.end);
    switch (rule.op) {
      case 'eq':
        return inRange;
      case 'neq':
        return !inRange;
      case 'gt':
        return v > endOfDay(range.end);
      case 'gte':
        return v >= range.start;
      case 'lt':
        return v < range.start;
      case 'lte':
        return v <= endOfDay(range.end);
      default:
        return false;
    }
  }

  switch (rule.op) {
    case 'eq':
      return eqValue(actual, expected);
    case 'neq':
      return !eqValue(actual, expected);
    case 'contains':
      return !isBlank(actual) && String(actual).toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'not_contains':
      return isBlank(actual) || !String(actual).toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'starts_with':
      return !isBlank(actual) && String(actual).toLowerCase().startsWith(String(expected ?? '').toLowerCase());
    case 'in':
      return (Array.isArray(expected) ? expected : [expected]).some((e) => eqValue(actual, e));
    case 'not_in':
      return !(Array.isArray(expected) ? expected : [expected]).some((e) => eqValue(actual, e));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const c = cmp(actual, expected);
      if (c === null) return false;
      return rule.op === 'gt' ? c > 0 : rule.op === 'gte' ? c >= 0 : rule.op === 'lt' ? c < 0 : c <= 0;
    }
    default:
      return false;
  }
}

export function matchesFilter(group: FilterGroup | null | undefined, values: Record<string, unknown>, opts: MatchOptions = {}): boolean {
  if (!group || group.rules.length === 0) return true;
  return group.match === 'any' ? group.rules.some((r) => matchesRule(r, values, opts)) : group.rules.every((r) => matchesRule(r, values, opts));
}

// ---------- Naming helpers ----------

export const API_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function toApiName(label: string): string {
  let s = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = 'field';
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  return s.slice(0, 40).replace(/_+$/, '');
}

export const OPERATOR_LABELS: Record<string, string> = {
  eq: 'equals',
  neq: 'not equal to',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  gt: 'greater than',
  gte: 'greater or equal',
  lt: 'less than',
  lte: 'less or equal',
  in: 'is any of',
  not_in: 'is none of',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

// Offline "rules brain": a deterministic planner used when no LLM provider is configured.
// It recognises a fixed set of CRM intents, plans tool calls (the same tools an LLM would use)
// and writes a markdown answer. It is intentionally transparent and limited; it is not an LLM.
import {
  type AgentDef,
  type FieldDef,
  type FilterRule,
  isBlank,
  numberFormat,
  type ObjectDef,
  type ReportResult,
  type SearchResultGroup,
  stringify,
  type UserDTO,
} from '@titoforce/shared';
import type { MetadataService } from '../platform/metadata.ts';
import { triageCase } from './tools.ts';

export interface ToolOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** The write was queued for human approval instead of being executed. */
  pending?: boolean;
  summary?: string;
}

export interface BrainCall {
  tool: string;
  args: Record<string, unknown>;
}

export type BrainPlan = AsyncGenerator<BrainCall, string, ToolOutcome>;
type Sub<T> = AsyncGenerator<BrainCall, T, ToolOutcome>;

export interface BrainContext {
  metadata: MetadataService;
  agent: AgentDef;
  /** Tools this agent may call (already filtered by autonomy). */
  tools: Set<string>;
  /** Record the agent was invoked on (record page or automation). */
  recordId: string | null;
  userId: string | null;
  /** Active human users, for "assign to …" / "owned by …". */
  users: UserDTO[];
  now: Date;
}

interface Target {
  id: string;
  name: string;
  object: string;
}

type Summary = { id: string; object: string; name: string; owner?: string; updated_at?: string } & Record<string, unknown>;

// ---------- text helpers ----------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w: string, plural = true) => new RegExp(`(?:^|[^a-z0-9])${esc(w.toLowerCase())}${plural ? '(?:s|es)?' : ''}(?=$|[^a-z0-9])`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeMd = (s: string) => s.replace(/([[\]])/g, '\\$1');
export const link = (r: { id: string; name: string }) => `[${escapeMd(r.name || r.id)}](/r/${r.id})`;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const ID_RE = /\b[a-z]{2,6}_[0-9a-z]{18,24}\b/;
const CLOSED_RE = /^(closed.*|.*\bwon|.*\blost|converted|completed?|done|resolved|cancell?ed|rejected|unqualified|terminated|hired|declined|archived|inactive|filled)$/i;

function formatValue(f: FieldDef | undefined, v: unknown): string {
  if (isBlank(v)) return '—';
  if (v && typeof v === 'object' && !Array.isArray(v) && 'id' in v) {
    const r = v as { id: string; name: string | null };
    return r.name ? link({ id: r.id, name: r.name }) : r.id;
  }
  const kind = f ? numberFormat(f) : null;
  if (kind === 'currency') return money(Number(v));
  if (kind === 'percent') return `${Number(v)}%`;
  if (kind === 'number') return Number(v).toLocaleString('en-US');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (f?.type === 'datetime' && typeof v === 'string') return v.slice(0, 10);
  const s = stringify(v).replace(/\s+/g, ' ');
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

function formatMetric(result: ReportResult, value: number): string {
  if (result.format === 'currency') return money(value);
  if (result.format === 'percent') return `${Math.round(value * 10) / 10}%`;
  return (Math.round(value * 100) / 100).toLocaleString('en-US');
}

export function parseMoney(s: string): number | null {
  const m = /\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?(?![a-z])/i.exec(s);
  if (!m) return null;
  let n = Number(m[1]!.replace(/,/g, ''));
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'k' || unit === 'thousand') n *= 1e3;
  else if (unit === 'm' || unit === 'million') n *= 1e6;
  else if (unit === 'b' || unit === 'billion') n *= 1e9;
  return Number.isFinite(n) ? n : null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Parses "tomorrow", "next week", "in 3 days", "friday", "2025-03-01" into YYYY-MM-DD. */
export function parseDate(lower: string, now: Date): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower);
  if (iso) return iso[1]!;
  if (/\b(today|tonight|end of (the )?day|eod)\b/.test(lower)) return isoDay(now);
  if (/\btomorrow\b/.test(lower)) return isoDay(addDays(now, 1));
  const inN = /\bin (\d{1,3}) (days?|weeks?|months?)\b/.exec(lower);
  if (inN) return isoDay(addDays(now, Number(inN[1]) * (inN[2]!.startsWith('week') ? 7 : inN[2]!.startsWith('month') ? 30 : 1)));
  if (/\bnext week\b/.test(lower)) return isoDay(addDays(now, 7));
  if (/\bnext month\b/.test(lower)) return isoDay(addDays(now, 30));
  if (/\bend of (the )?month\b/.test(lower)) return isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  if (/\bend of (the )?quarter\b/.test(lower)) return isoDay(new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3 + 3, 0)));
  const wd = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(lower);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]!);
    let diff = (target - now.getUTCDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return isoDay(addDays(now, diff));
  }
  return null;
}

const DATE_WORDS_RE =
  /\s+(?:(?:by|on|due|for)\s+)?(?:today|tonight|tomorrow|next (?:week|month)|end of (?:the )?(?:day|month|quarter)|in \d{1,3} (?:days?|weeks?|months?)|(?:this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2})\b/gi;

// ---------- object & record resolution ----------

const SYNONYMS: [string, RegExp][] = [
  ['opportunity', /\b(deals?|opportunit(?:y|ies)|opps?|pipeline|forecast)\b/],
  ['lead', /\b(leads?|prospects?)\b/],
  ['account', /\b(accounts?|compan(?:y|ies)|customers?|clients?)\b/],
  ['contact', /\b(contacts?|people)\b/],
  ['case', /\b(cases?|tickets?)\b/],
  ['activity', /\b(tasks?|activit(?:y|ies)|calls?|meetings?|to-?dos?|follow[- ]?ups?)\b/],
  ['time_off_request', /\b(time[- ]off(?: requests?)?|pto|vacations?|leave requests?)\b/],
  ['employee', /\b(employees?|staff|headcount|team members?|direct reports?)\b/],
  ['knowledge_article', /\b(knowledge(?: base)?|articles?|kb)\b/],
  ['candidate', /\b(candidates?|applicants?)\b/],
  ['job_requisition', /\b(job openings?|openings?|requisitions?|open roles?|jobs?)\b/],
  ['performance_review', /\b(performance reviews?|reviews?)\b/],
  ['project', /\b(projects?)\b/],
  ['work_item', /\b(work items?|board items?)\b/],
  ['campaign', /\b(campaigns?)\b/],
  ['product', /\b(products?)\b/],
  ['quote', /\b(quotes?)\b/],
  ['department', /\b(departments?)\b/],
  ['web_form', /\b(web forms?)\b/],
];

const LEADING_OBJECT_RE =
  /^(?:the\s+|a\s+|an\s+|my\s+|our\s+)?(?:leads?|accounts?|deals?|opportunit(?:y|ies)|opps?|cases?|tickets?|contacts?|compan(?:y|ies)|customers?|employees?|projects?|records?|candidates?|quotes?|campaigns?|tasks?)\b\s*/i;

export function detectObject(metadata: MetadataService, lower: string): ObjectDef | null {
  const hits: { def: ObjectDef; index: number; len: number }[] = [];
  for (const def of metadata.list()) {
    for (const label of new Set([def.label, def.pluralLabel, def.apiName.replace(/_/g, ' ')])) {
      const m = new RegExp(`\\b${esc(label.toLowerCase())}\\b`).exec(lower);
      if (m) hits.push({ def, index: m.index, len: m[0].length });
    }
  }
  for (const [api, re] of SYNONYMS) {
    const def = metadata.get(api);
    const m = def ? re.exec(lower) : null;
    if (def && m) hits.push({ def, index: m.index, len: m[0].length });
  }
  hits.sort((a, b) => a.index - b.index || b.len - a.len);
  return hits[0]?.def ?? null;
}

function quoted(text: string): string | null {
  const m = /["“”]([^"“”]{1,100})["“”]/.exec(text) ?? /(?:^|\s)'([^']{1,100})'(?=$|[\s.,!?])/.exec(text);
  return m ? m[1]!.trim() : null;
}

function cleanName(s: string | undefined | null): string | null {
  if (!s) return null;
  let t = s.trim().replace(/[?.!]+$/, '').trim();
  if (/^(?:this|that|the current|current)(?:\s+[a-z]+){0,2}\s+(?:lead|account|deal|opportunity|opp|case|ticket|contact|company|customer|employee|project|record|candidate|quote|campaign|task|item|request|review|article|requisition|product|department|form|one|activity)$/i.test(t))
    return 'this';
  for (let i = 0; i < 2; i++) t = t.replace(LEADING_OBJECT_RE, '').replace(/^(?:named|called|for|on|with|about)\s+/i, '').trim();
  t = t.replace(/^["“”']|["“”']$/g, '').trim();
  if (!t) return null;
  if (/^(this|it|that|this one|the record|current record|here)$/i.test(t)) return 'this';
  return t;
}

function findUser(ctx: BrainContext, s: string): UserDTO | null {
  const q = s.toLowerCase().trim().replace(/[.!?]+$/, '');
  if (/^(me|myself|i)$/.test(q)) return ctx.users.find((u) => u.id === ctx.userId) ?? null;
  return (
    ctx.users.find((u) => u.name.toLowerCase() === q) ??
    ctx.users.find((u) => u.name.toLowerCase().startsWith(q)) ??
    ctx.users.find((u) => u.name.toLowerCase().split(/\s+/).includes(q)) ??
    null
  );
}

function matchOption(f: FieldDef, value: string): string | null {
  const v = value.toLowerCase().trim();
  const opts = f.options ?? [];
  return (
    opts.find((o) => o.value.toLowerCase() === v)?.value ??
    opts.find((o) => o.value.toLowerCase().startsWith(v))?.value ??
    opts.find((o) => v.includes(o.value.toLowerCase()))?.value ??
    null
  );
}

function fieldByLabel(def: ObjectDef, text: string): FieldDef | null {
  const t = text.toLowerCase().trim();
  return (
    def.fields.find((f) => f.label.toLowerCase() === t || f.apiName === t.replace(/\s+/g, '_')) ??
    def.fields.find((f) => f.label.toLowerCase().startsWith(t) && t.length >= 3) ??
    null
  );
}

async function* call(tool: string, args: Record<string, unknown>): Sub<ToolOutcome> {
  return yield { tool, args };
}

async function* findRecord(name: string, object: string | null): Sub<Target | null> {
  const out = yield* call('search_records', object ? { query: name, object } : { query: name });
  if (!out.ok) return null;
  const all = (out.result as SearchResultGroup[]).flatMap((g) => g.records.map((r) => ({ id: r.id, name: r.name, object: g.object })));
  return all.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? all[0] ?? null;
}

/** Resolves the record a command refers to: an explicit id, a quoted/derived name, or the record in context. */
async function* resolveTarget(ctx: BrainContext, text: string, objectHint: string | null, candidate: string | null): Sub<Target | null> {
  const id = ID_RE.exec(text)?.[0] ?? (candidate === 'this' || (!candidate && !quoted(text)) ? ctx.recordId : null);
  if (id) {
    const out = yield* call('get_record', { id });
    if (out.ok) {
      const r = out.result as Summary;
      return { id: r.id, name: r.name, object: r.object };
    }
    if (id !== ctx.recordId) return null;
  }
  const name = quoted(text) ?? (candidate !== 'this' ? candidate : null);
  if (!name) return null;
  return (yield* findRecord(name, objectHint)) ?? (objectHint ? yield* findRecord(name, null) : null);
}

// ---------- filters ----------

interface ParsedFilters {
  rules: FilterRule[];
  notes: string[];
}

function primaryAmountField(def: ObjectDef, lower: string): FieldDef | null {
  const numeric = def.fields.filter((f) => !f.sensitive && ['currency', 'number', 'percent'].includes(numberFormat(f) ?? ''));
  return (
    numeric.find((f) => wordRe(f.label, false).test(lower)) ??
    numeric.find((f) => f.apiName === 'amount') ??
    numeric.find((f) => numberFormat(f) === 'currency' && f.type === 'currency') ??
    numeric.find((f) => numberFormat(f) === 'currency') ??
    numeric[0] ??
    null
  );
}

function dateFieldFor(def: ObjectDef, lower: string): { field: string; label: string } {
  const dates = def.fields.filter((f) => f.type === 'date' || f.type === 'datetime');
  const pick = (re: RegExp) => dates.find((f) => re.test(f.apiName));
  if (/\b(created|added|new this|came in|submitted)\b/.test(lower)) return { field: 'created_at', label: 'Created' };
  if (/\b(updated|modified|changed)\b/.test(lower)) return { field: 'updated_at', label: 'Last modified' };
  const f =
    (/\bclos(e|ing|es)\b/.test(lower) ? pick(/close/) : undefined) ??
    (/\b(due|overdue)\b/.test(lower) ? pick(/due/) : undefined) ??
    (/\b(start|starting|begins?)\b/.test(lower) ? pick(/start/) : undefined) ??
    (/\b(end|ending)\b/.test(lower) ? pick(/end/) : undefined) ??
    (/\b(hired|joined)\b/.test(lower) ? pick(/hire|join/) : undefined) ??
    (def.dateField ? dates.find((d) => d.apiName === def.dateField) : undefined);
  return f ? { field: f.apiName, label: f.label } : { field: 'created_at', label: 'Created' };
}

const PERIODS: [RegExp, string, string][] = [
  [/\btoday\b/, 'TODAY', 'today'],
  [/\btomorrow\b/, 'TOMORROW', 'tomorrow'],
  [/\byesterday\b/, 'YESTERDAY', 'yesterday'],
  [/\bthis week\b/, 'THIS_WEEK', 'this week'],
  [/\bnext week\b/, 'NEXT_WEEK', 'next week'],
  [/\blast week\b/, 'LAST_WEEK', 'last week'],
  [/\bthis month\b/, 'THIS_MONTH', 'this month'],
  [/\bnext month\b/, 'NEXT_MONTH', 'next month'],
  [/\blast month\b/, 'LAST_MONTH', 'last month'],
  [/\bthis quarter\b/, 'THIS_QUARTER', 'this quarter'],
  [/\bnext quarter\b/, 'NEXT_QUARTER', 'next quarter'],
  [/\blast quarter\b/, 'LAST_QUARTER', 'last quarter'],
  [/\bthis year\b/, 'THIS_YEAR', 'this year'],
  [/\blast year\b/, 'LAST_YEAR', 'last year'],
  [/\bnext year\b/, 'NEXT_YEAR', 'next year'],
];

/** Derives filter rules from natural language for one object. Account names are resolved with search. */
async function* parseFilters(ctx: BrainContext, def: ObjectDef, text: string, opts: { skipNames?: string[] } = {}): Sub<ParsedFilters> {
  let lower = ` ${text.toLowerCase()} `;
  for (const n of opts.skipNames ?? []) lower = lower.replace(n.toLowerCase(), ' ');
  const rules: FilterRule[] = [];
  const notes: string[] = [];
  const status = def.statusField ? def.fields.find((f) => f.apiName === def.statusField) : undefined;

  // Picklist values mentioned in the text, longest first, without overlapping matches.
  const picks = def.fields.filter((f) => (f.type === 'picklist' || f.type === 'multipicklist') && !f.sensitive);
  const candidates: { f: FieldDef; value: string; index: number; len: number }[] = [];
  for (const f of picks) {
    for (const o of f.options ?? []) {
      if (o.value.length < 2) continue;
      const m = wordRe(o.value).exec(lower);
      if (m) candidates.push({ f, value: o.value, index: m.index, len: m[0].length });
    }
  }
  candidates.sort((a, b) => b.len - a.len || (a.f === status ? -1 : b.f === status ? 1 : 0));
  const taken: [number, number][] = [];
  const byField = new Map<FieldDef, string[]>();
  for (const c of candidates) {
    if (taken.some(([s, e]) => c.index < e && s < c.index + c.len)) continue;
    taken.push([c.index, c.index + c.len]);
    byField.set(c.f, [...(byField.get(c.f) ?? []), c.value]);
  }
  for (const [f, values] of byField) {
    rules.push(values.length === 1 ? { field: f.apiName, op: f.type === 'multipicklist' ? 'contains' : 'eq', value: values[0] } : { field: f.apiName, op: 'in', value: values });
    notes.push(`${f.label} ${values.length === 1 ? '=' : 'in'} ${values.join(', ')}`);
  }
  if (status && !byField.has(status)) {
    const closed = (status.options ?? []).map((o) => o.value).filter((v) => CLOSED_RE.test(v));
    if (/\b(open|active|pending|in progress|unresolved|outstanding)\b/.test(lower) && closed.length) {
      rules.push({ field: status.apiName, op: 'not_in', value: closed });
      notes.push(`${status.label} is open`);
    } else if (/\b(closed|resolved|finished|completed)\b/.test(lower) && closed.length) {
      rules.push({ field: status.apiName, op: 'in', value: closed });
      notes.push(`${status.label} is closed`);
    }
  }

  // Ownership
  if (/\b(my|mine|i own|assigned to me|owned by me)\b/.test(lower) && ctx.userId) {
    rules.push({ field: 'owner_id', op: 'eq', value: 'CURRENT_USER' });
    notes.push('Owner = you');
  } else {
    const owner = /\b(?:owned by|assigned to|belonging to)\s+([a-z]+(?:\s[a-z]+)?)/.exec(lower);
    const user = owner ? findUser(ctx, owner[1]!) ?? findUser(ctx, owner[1]!.split(' ')[0]!) : null;
    if (user) {
      rules.push({ field: 'owner_id', op: 'eq', value: user.id });
      notes.push(`Owner = ${user.name}`);
    }
  }

  // Amount comparisons
  const cmp = /\b(over|above|more than|greater than|at least|bigger than|larger than|under|below|less than|at most|smaller than)\s+(\$?\s*\d[\d,.]*\s*(?:k|m|b|thousand|million|billion)?)(?![a-z])/.exec(lower) ?? /([<>]=?)\s*(\$?\s*\d[\d,.]*\s*(?:k|m|b)?)(?![a-z])/.exec(lower);
  if (cmp) {
    const amountField = primaryAmountField(def, lower);
    const n = parseMoney(cmp[2]!);
    if (amountField && n !== null) {
      const word = cmp[1]!;
      const op: FilterRule['op'] = /over|above|more|greater|bigger|larger|^>$/.test(word) ? 'gt' : /at least|>=/.test(word) ? 'gte' : /at most|<=/.test(word) ? 'lte' : 'lt';
      rules.push({ field: amountField.apiName, op, value: n });
      notes.push(`${amountField.label} ${{ gt: '>', gte: '≥', lt: '<', lte: '≤' }[op as 'gt']} ${numberFormat(amountField) === 'currency' ? money(n) : n}`);
    }
  }

  // Dates
  const df = dateFieldFor(def, lower);
  if (/\b(overdue|past due|late)\b/.test(lower)) {
    const due = def.fields.find((f) => /due|close|end/.test(f.apiName) && (f.type === 'date' || f.type === 'datetime'));
    if (due) {
      rules.push({ field: due.apiName, op: 'lt', value: 'TODAY' });
      notes.push(`${due.label} before today`);
      if (status && !byField.has(status) && !rules.some((r) => r.field === status.apiName)) {
        const closed = (status.options ?? []).map((o) => o.value).filter((v) => CLOSED_RE.test(v));
        if (closed.length) rules.push({ field: status.apiName, op: 'not_in', value: closed });
      }
    }
  } else {
    const nDays = /\b(last|past|next|coming) (\d{1,3}) days\b/.exec(lower);
    const period = PERIODS.find(([re]) => re.test(lower));
    if (nDays) {
      const lit = `${nDays[1] === 'last' || nDays[1] === 'past' ? 'LAST' : 'NEXT'}_N_DAYS:${nDays[2]}`;
      rules.push({ field: df.field, op: 'eq', value: lit });
      notes.push(`${df.label} in the ${nDays[1]} ${nDays[2]} days`);
    } else if (period) {
      rules.push({ field: df.field, op: 'eq', value: period[1] });
      notes.push(`${df.label} ${period[2]}`);
    }
  }

  // "at Acme", "for Globex": filter by a lookup to the named record.
  const lookups = def.fields.filter((f) => f.type === 'lookup' && f.referenceTo && f.referenceTo !== '*' && !f.sensitive);
  const rel = /\b(?:at|for|from|with|of)\s+(?!the\b|my\b|this\b|next\b|last\b|me\b|us\b|over\b|under\b|least\b|most\b)((?:[A-Z0-9][\w&.'-]*)(?:\s+(?:[A-Z0-9][\w&.'-]*|&|of|and)){0,4})/.exec(text);
  if (rel && lookups.length) {
    const relName = rel[1]!.replace(/\s+(?:and|of|&)$/, '').trim();
    const preferred = lookups.find((f) => f.referenceTo === 'account') ?? lookups[0]!;
    const found = yield* findRecord(relName, preferred.referenceTo!);
    const field = found ? (lookups.find((f) => f.referenceTo === found.object) ?? null) : null;
    if (found && field) {
      rules.push({ field: field.apiName, op: 'eq', value: found.id });
      notes.push(`${field.label} = ${found.name}`);
    }
  }

  // "named X" / "containing X"
  const nameMatch = /\b(?:named|called|containing|matching)\s+["“]?([^"”,]+?)["”]?(?=$|[,.?!])/i.exec(text);
  if (nameMatch) {
    rules.push({ field: 'name', op: 'contains', value: nameMatch[1]!.trim() });
    notes.push(`Name contains "${nameMatch[1]!.trim()}"`);
  }
  return { rules, notes };
}

// ---------- rendering ----------

function displayFields(def: ObjectDef, exclude: string[] = []): FieldDef[] {
  const names = [...(def.highlightFields ?? []), ...(def.listFields ?? [])];
  const out: FieldDef[] = [];
  for (const n of names) {
    const f = def.fields.find((x) => x.apiName === n);
    if (f && !exclude.includes(n) && !out.includes(f) && f.apiName !== def.nameField) out.push(f);
  }
  return out;
}

function recordLine(def: ObjectDef | undefined, r: Summary, max = 3): string {
  const parts = def
    ? displayFields(def)
        .filter((f) => !isBlank(r[f.apiName]))
        .slice(0, max)
        .map((f) => `${f.label}: ${formatValue(f, r[f.apiName])}`)
    : [];
  return `- ${link(r)}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}

function pendingOr(out: ToolOutcome, done: string): string {
  if (out.pending) return `⏳ Requested approval to ${lowerFirst(out.summary ?? 'make this change')}. A person must approve it in **Approvals** before it runs.`;
  return done;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------- intents ----------

function help(ctx: BrainContext): string {
  const can = (t: string) => ctx.tools.has(t);
  const lines = [`I'm **${ctx.agent.name}**. ${ctx.agent.description}`.trim(), '', 'Try asking me to:'];
  if (can('query_records')) lines.push('- **Find records** — "show open deals over 50k closing this quarter", "my overdue tasks", "contacts at Acme"');
  if (can('aggregate_records')) lines.push('- **Answer questions** — "how many open cases by priority", "total pipeline by stage"');
  if (can('get_record')) lines.push('- **Summarize** — "summarize Acme Corporation" (or open a record and ask "summarize this")');
  if (can('score_lead')) lines.push('- **Qualify leads** — "qualify all new leads"');
  if (can('update_record') && ctx.metadata.get('case')) lines.push('- **Triage cases** — "triage new cases"');
  if (can('create_record')) lines.push('- **Create** — "create a lead named Dana Lee at Initech, email dana@initech.com"');
  if (can('update_record')) lines.push('- **Update** — "move Globex Renewal to Negotiation", "mark \\"Login error\\" as Closed"');
  if (can('log_activity')) lines.push('- **Log work** — "log a call with Acme about renewal", "remind me to email Jane tomorrow"');
  if (can('convert_lead')) lines.push('- **Convert leads** — "convert lead Dana Lee"');
  if (can('search_knowledge')) lines.push('- **Knowledge** — "how do I reset my password?"');
  if (![...ctx.tools].some((t) => ['create_record', 'update_record', 'log_activity', 'convert_lead'].includes(t))) lines.push('', 'I am read-only: I can look things up but not change data.');
  lines.push('', '_Offline mode: answers come from titoForce’s built-in rules engine, not an LLM. Configure an AI provider for open-ended conversation._');
  return lines.join('\n');
}

async function* qualifyLeads(ctx: BrainContext, text: string, lower: string): BrainPlan {
  if (!ctx.metadata.get('lead') || !ctx.tools.has('score_lead')) return "I can't score leads — the score_lead tool isn't enabled for me.";
  const lead = ctx.metadata.require('lead');
  let targets: Target[] = [];
  if (/\b(all|every|new|unqualified|pending|open)\b.*\bleads\b|\bleads\b.*\b(all|new)\b/.test(lower)) {
    const status = lead.fields.find((f) => f.apiName === 'status');
    const rules: FilterRule[] = status?.options?.some((o) => o.value === 'New') ? [{ field: 'status', op: 'eq', value: 'New' }] : [];
    const out = yield* call('query_records', { object: 'lead', filters: rules, sort_field: 'created_at', sort_dir: 'desc', limit: 10 });
    if (!out.ok) return `I couldn't load leads: ${out.error}`;
    targets = (out.result as { records: Summary[] }).records.map((r) => ({ id: r.id, name: r.name, object: 'lead' }));
    if (!targets.length) return 'There are no new leads to qualify. 🎉';
  } else {
    const m = /\b(?:qualify|score|rate|assess)\s+(.+)$/i.exec(text);
    const t = yield* resolveTarget(ctx, text, 'lead', cleanName(m?.[1]));
    if (!t) return "I couldn't tell which lead you mean. Try `qualify lead \"Jane Doe\"` or open a lead and ask me to qualify it.";
    if (t.object !== 'lead') return `${link(t)} is not a lead.`;
    targets = [t];
  }
  const lines: string[] = [];
  const hasField = (n: string) => lead.fields.some((f) => f.apiName === n);
  for (const t of targets) {
    const out = yield* call('score_lead', { id: t.id });
    if (!out.ok) {
      lines.push(`- ${link(t)} — could not score: ${out.error}`);
      continue;
    }
    const s = out.result as { score: number; rating: string; factors: { factor: string; points: number }[] };
    const why = s.factors
      .filter((f) => f.points !== 0)
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
      .slice(0, 3)
      .map((f) => `${f.factor} (${f.points > 0 ? '+' : ''}${f.points})`)
      .join(', ');
    let action = '';
    if (ctx.tools.has('update_record')) {
      const fields: Record<string, unknown> = {};
      if (hasField('lead_score')) fields.lead_score = s.score;
      if (hasField('rating')) fields.rating = s.rating;
      if (Object.keys(fields).length) {
        const upd = yield* call('update_record', { id: t.id, fields });
        action = upd.ok ? (upd.pending ? ' · update awaiting approval' : ' · saved') : ` · not saved (${upd.error})`;
      }
    }
    if (s.rating === 'Hot' && ctx.tools.has('log_activity')) {
      const task = yield* call('log_activity', { related_to: t.id, type: 'Task', subject: `Call hot lead ${t.name} within 24h`, due_date: isoDay(addDays(ctx.now, 1)), status: 'Open' });
      if (task.ok) action += task.pending ? ' · follow-up task awaiting approval' : ' · follow-up task created';
    }
    lines.push(`- ${link(t)} — **${s.score}/100 (${s.rating})**${why ? `: ${why}` : ''}${action}`);
  }
  const header = targets.length === 1 ? 'Lead qualification:' : `Qualified **${targets.length}** leads:`;
  return [header, ...lines, '', '_Scores use a transparent rules model (title, company size, source, email domain, buying signals)._'].join('\n');
}

async function* triageCases(ctx: BrainContext, text: string, lower: string): BrainPlan {
  const def = ctx.metadata.get('case');
  if (!def) return 'Case management is not set up in this org.';
  let targets: Target[] = [];
  if (/\b(all|every|new|open|untriaged|unassigned)\b.*\b(cases|tickets)\b/.test(lower)) {
    const status = def.fields.find((f) => f.apiName === 'status');
    const rules: FilterRule[] = status?.options?.some((o) => o.value === 'New') ? [{ field: 'status', op: 'eq', value: 'New' }] : [];
    const out = yield* call('query_records', { object: 'case', filters: rules, sort_field: 'created_at', sort_dir: 'desc', limit: 10 });
    if (!out.ok) return `I couldn't load cases: ${out.error}`;
    targets = (out.result as { records: Summary[] }).records.map((r) => ({ id: r.id, name: r.name, object: 'case' }));
    if (!targets.length) return 'There are no new cases to triage. 🎉';
  } else {
    const m = /\b(?:triage|prioriti[sz]e|categori[sz]e|classify)\s+(.+)$/i.exec(text);
    const t = yield* resolveTarget(ctx, text, 'case', cleanName(m?.[1]));
    if (!t) return "I couldn't tell which case you mean. Open a case and ask me to triage it, or say `triage new cases`.";
    if (t.object !== 'case') return `${link(t)} is not a case.`;
    targets = [t];
  }
  const lines: string[] = [];
  for (const t of targets) {
    const got = yield* call('get_record', { id: t.id });
    if (!got.ok) {
      lines.push(`- ${link(t)} — ${got.error}`);
      continue;
    }
    const rec = got.result as Summary;
    const tri = triageCase(rec);
    const fields: Record<string, unknown> = {};
    const prio = def.fields.find((f) => f.apiName === 'priority');
    const cat = def.fields.find((f) => f.apiName === 'category');
    if (prio && matchOption(prio, tri.priority) && rec.priority !== tri.priority) fields.priority = matchOption(prio, tri.priority);
    if (cat && matchOption(cat, tri.category) && rec.category !== tri.category) fields.category = matchOption(cat, tri.category);
    let action = '';
    if (Object.keys(fields).length && ctx.tools.has('update_record')) {
      const upd = yield* call('update_record', { id: t.id, fields });
      action = upd.ok ? (upd.pending ? ' (update awaiting approval)' : ' (updated)') : ` (not saved: ${upd.error})`;
    } else if (!Object.keys(fields).length) action = ' (already set)';
    let kb = '';
    if (ctx.tools.has('search_knowledge')) {
      const k = yield* call('search_knowledge', { query: `${rec.name} ${stringify(rec.description ?? '')}`.slice(0, 200) });
      const articles = k.ok ? (k.result as { id: string; title: string }[]) : [];
      if (articles.length) kb = `\n  Suggested articles: ${articles.map((a) => link({ id: a.id, name: a.title })).join(', ')}`;
    }
    lines.push(`- ${link(t)} — priority **${tri.priority}**, category **${tri.category}**${action}. ${tri.reasons[0] ?? ''}${kb}`);
  }
  return [targets.length === 1 ? 'Triage result:' : `Triaged **${targets.length}** cases:`, ...lines].join('\n');
}

async function* convertLead(ctx: BrainContext, text: string): BrainPlan {
  if (!ctx.tools.has('convert_lead')) return "I'm not allowed to convert leads.";
  const m = /\bconvert\s+(.+?)(?:\s+(?:with|without|into|to)\b.*)?$/i.exec(text);
  const t = yield* resolveTarget(ctx, text, 'lead', cleanName(m?.[1]));
  if (!t) return 'Which lead should I convert? Try `convert lead "Jane Doe"`.';
  if (t.object !== 'lead') return `${link(t)} is not a lead.`;
  const out = yield* call('convert_lead', { id: t.id, create_opportunity: !/\bwithout (an? )?(opportunit|deal)/i.test(text) });
  if (!out.ok) return `I couldn't convert ${link(t)}: ${out.error}`;
  if (out.pending) return pendingOr(out, '');
  const r = out.result as { account: Target & { reused: boolean }; contact: Target; opportunity: Target | null };
  return [
    `Converted ${link(t)}:`,
    `- Account: ${link(r.account)}${r.account.reused ? ' (existing)' : ' (new)'}`,
    `- Contact: ${link(r.contact)}`,
    r.opportunity ? `- Opportunity: ${link(r.opportunity)}` : '- No opportunity created',
  ].join('\n');
}

async function* summarize(ctx: BrainContext, text: string, lower: string): BrainPlan {
  const m = /\b(?:summari[sz]e|summary of|brief me on|tell me about|overview of|catch me up on|what'?s (?:going on|happening) with|status of|review|analy[sz]e|assess|coach me on)\s+(.+)$/i.exec(text);
  const hint = detectObject(ctx.metadata, (m?.[1] ?? '').toLowerCase());
  const t = yield* resolveTarget(ctx, text, hint?.apiName ?? null, cleanName(m?.[1]?.replace(/\b(?:and|then)\b.*$/i, '')));
  if (!t) return "I couldn't find that record. Open a record and ask me to summarize it, or use its exact name in quotes.";
  const def = ctx.metadata.get(t.object);
  const got = yield* call('get_record', { id: t.id });
  if (!got.ok) return `I couldn't read ${link(t)}: ${got.error}`;
  const rec = got.result as Summary;
  const lines = [`**${link(rec)}** · ${def?.label ?? rec.object}${rec.owner ? ` · owned by ${rec.owner}` : ''}`];
  const facts = def
    ? (displayFields(def).length ? displayFields(def) : def.fields)
        .filter((f) => !isBlank(rec[f.apiName]) && f.type !== 'longtext')
        .slice(0, 6)
    : [];
  for (const f of facts) lines.push(`- ${f.label}: ${formatValue(f, rec[f.apiName])}`);
  const desc = def?.fields.find((f) => f.type === 'longtext' && !isBlank(rec[f.apiName]));
  if (desc) lines.push(`- ${desc.label}: ${formatValue(desc, rec[desc.apiName])}`);

  const rel = yield* call('get_related_records', { id: t.id });
  const lists = rel.ok ? (rel.result as { list: string; total: number }[]) : [];
  if (lists.some((l) => l.total > 0))
    lines.push(
      '',
      `**Related:** ${lists
        .filter((l) => l.total > 0)
        .map((l) => `${l.total} ${l.list}`)
        .join(', ')}`,
    );

  const tl = yield* call('get_timeline', { id: t.id });
  const items = tl.ok ? (tl.result as { kind: string; at: string; title: string; type?: string; status?: string; due?: string; by?: string }[]) : [];
  const activities = items.filter((i) => i.kind === 'activity');
  if (activities.length) {
    lines.push('', '**Recent activity:**');
    for (const a of activities.slice(0, 4)) lines.push(`- ${a.at.slice(0, 10)} · ${a.type ?? 'Activity'}: ${a.title}${a.status === 'Open' ? ' (open)' : ''}${a.by ? ` — ${a.by}` : ''}`);
  }

  // Next-step heuristics.
  const today = isoDay(ctx.now);
  const next: string[] = [];
  const lastTouch = activities[0]?.at ?? null;
  const daysSince = lastTouch ? Math.floor((ctx.now.getTime() - Date.parse(lastTouch)) / 86_400_000) : null;
  const statusValue = def?.statusField ? String(rec[def.statusField] ?? '') : '';
  const isClosed = CLOSED_RE.test(statusValue);
  const overdue = activities.filter((a) => a.status === 'Open' && a.due && a.due < today);
  if (overdue.length) next.push(`${overdue.length} overdue task${overdue.length > 1 ? 's' : ''} — complete or reschedule ${overdue.length > 1 ? 'them' : 'it'}.`);
  if (!isClosed && (daysSince === null || daysSince > 14)) next.push(daysSince === null ? 'No logged activity yet — schedule a first touchpoint.' : `No activity in ${daysSince} days — schedule a follow-up.`);
  if (t.object === 'opportunity' && !isClosed) {
    if (typeof rec.close_date === 'string' && rec.close_date < today) next.push('Close date has passed — update the close date or stage.');
    if (isBlank(rec.amount)) next.push('Add an amount so the deal counts toward the forecast.');
    if (isBlank(rec.next_step)) next.push('Record a concrete next step.');
  }
  if (t.object === 'case' && !isClosed && /high|urgent/i.test(String(rec.priority ?? '')) && /new/i.test(statusValue)) next.push('High-priority case is still New — assign it and respond to the customer.');
  if (t.object === 'lead' && /new/i.test(statusValue)) next.push('Qualify this lead (ask me to "qualify this lead").');
  if (next.length) {
    lines.push('', '**Suggested next steps:**');
    for (const n of next) lines.push(`- ${n}`);
  }
  if (next.length && /\b(next steps?|follow[- ]?up|action items?|create (a )?task)\b/.test(lower) && ctx.tools.has('log_activity') && !isClosed) {
    const task = yield* call('log_activity', { related_to: t.id, type: 'Task', subject: next[0]!.replace(/\s+—.*$/, ''), due_date: isoDay(addDays(ctx.now, 2)), status: 'Open' });
    lines.push('', task.ok ? pendingOr(task, `✅ Created a follow-up task: "${next[0]!.replace(/\s+—.*$/, '')}".`) : `I couldn't create a follow-up task: ${task.error}`);
  }
  return lines.join('\n');
}

const ACTIVITY_TYPES: [RegExp, string][] = [
  [/\bcall(ed|s)?\b|\bphone\b/, 'Call'],
  [/\be-?mail(ed|s)?\b/, 'Email'],
  [/\bmeeting|\bmet with\b|\bmeet\b/, 'Meeting'],
  [/\bnote\b/, 'Note'],
];

async function* logActivity(ctx: BrainContext, text: string, lower: string): BrainPlan {
  if (!ctx.tools.has('log_activity')) return "I'm not allowed to log activities.";
  const type = /\b(remind|reminder|task|to-?do|follow[- ]?up)\b/.test(lower) && !/\blog (a |an )?(call|email|meeting)\b/.test(lower) ? 'Task' : (ACTIVITY_TYPES.find(([re]) => re.test(lower))?.[1] ?? 'Task');
  const due = parseDate(lower, ctx.now);
  const stripped = text.replace(DATE_WORDS_RE, '');
  const nameStop = String.raw`(?=\s+(?:about|regarding|re:?|to discuss|on|for|that|and)\b|[.,;:!?]|$)`;
  const targetMatch =
    new RegExp(String.raw`\b(?:with|on|for)\s+(?!me\b|the record\b)(.+?)${nameStop}`, 'i').exec(stripped) ??
    new RegExp(String.raw`\b(?:call|email|e-mail|meet(?: with)?|ping|contact|reach out to|follow up with)\s+(?!me\b)(.+?)${nameStop}`, 'i').exec(stripped);
  const candidate = cleanName(targetMatch?.[1]);
  const t = yield* resolveTarget(ctx, text, null, candidate);
  if (!t) return `I couldn't find ${candidate && candidate !== 'this' ? `"${candidate}"` : 'which record to log this on'}. Mention the record name (e.g. "log a call with Acme about pricing") or open the record first.`;
  const topic = /\b(?:about|regarding|re:?|to discuss)\s+(.+?)(?:[.;!?]|$)/i.exec(stripped)?.[1]?.trim();
  const colon = /:\s*(.+)$/.exec(stripped)?.[1]?.trim();
  const reminder = /\bremind me to\s+(.+?)(?:[.;!?]|$)/i.exec(stripped)?.[1]?.trim();
  const subject = cap(reminder ?? (topic ? `${type === 'Note' || type === 'Task' ? '' : `${type}: `}${topic}` : (colon ?? `${type} with ${t.name}`)));
  const open = type === 'Task' || /\b(schedule|plan|set up|book)\b/.test(lower) || (!!due && due > isoDay(ctx.now));
  const out = yield* call('log_activity', {
    related_to: t.id,
    type,
    subject,
    description: colon && colon !== subject ? colon : undefined,
    due_date: due ?? (open ? isoDay(addDays(ctx.now, 1)) : isoDay(ctx.now)),
    status: open ? 'Open' : 'Completed',
  });
  if (!out.ok) return `I couldn't log that: ${out.error}`;
  return pendingOr(out, `✅ ${open ? 'Created' : 'Logged'} ${type.toLowerCase()} "${subject}" on ${link(t)}${open ? ` (due ${due ?? isoDay(addDays(ctx.now, 1))})` : ''}.`);
}

async function* createRecord(ctx: BrainContext, text: string, lower: string): BrainPlan {
  if (!ctx.tools.has('create_record')) return "I'm not allowed to create records.";
  const def = detectObject(ctx.metadata, lower);
  if (!def) return 'What should I create? For example: `create a lead named Dana Lee at Initech`.';
  const fields: Record<string, unknown> = {};
  const notes: string[] = [];
  const editable = def.fields.filter((f) => f.type !== 'formula' && f.type !== 'rollup' && !f.sensitive);
  const nameStop = String.raw`(?=\s+(?:at|from|for|with|in|worth|amount|priority|stage|status|email|phone|due|closing|who|that|and|title)\b|[,;.]|$)`;
  const name = quoted(text) ?? new RegExp(String.raw`\b(?:named|called|titled|subject|for)\s+(.+?)${nameStop}`, 'i').exec(text)?.[1]?.trim() ?? null;
  let rest = name ? text.replace(name, ' ') : text;
  if (name) {
    if (def.nameTemplate && def.fields.some((f) => f.apiName === 'first_name') && def.fields.some((f) => f.apiName === 'last_name')) {
      const parts = name.split(/\s+/);
      fields.last_name = parts.pop();
      if (parts.length) fields.first_name = parts.join(' ');
    } else if (def.fields.some((f) => f.apiName === def.nameField)) fields[def.nameField] = name;
  }
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(rest)?.[0];
  const emailField = editable.find((f) => f.type === 'email');
  if (email && emailField) {
    fields[emailField.apiName] = email;
    rest = rest.replace(email, ' ');
  }
  const phone = /\+?\d[\d\s().-]{7,}\d/.exec(rest)?.[0];
  const phoneField = editable.find((f) => f.type === 'phone');
  if (phone && phoneField && !/\$/.test(phone)) {
    fields[phoneField.apiName] = phone.trim();
    rest = rest.replace(phone, ' ');
  }
  const restLower = rest.toLowerCase();
  const moneyMatch = /(?:\$\s*\d[\d,.]*\s*(?:k|m|b|thousand|million)?|\b\d[\d,.]*\s*(?:k|m|thousand|million)\b|\b(?:worth|amount|value|budget)\s+(?:of\s+)?\$?\d[\d,.]*\s*(?:k|m)?)/i.exec(rest);
  const amountField = primaryAmountField(
    { ...def, fields: editable },
    restLower,
  );
  if (moneyMatch && amountField && numberFormat(amountField) === 'currency') {
    const n = parseMoney(moneyMatch[0].replace(/^[a-z\s]+/i, ''));
    if (n !== null) fields[amountField.apiName] = n;
    rest = rest.replace(moneyMatch[0], ' ');
  }
  // "at/from <Company>": text company field on leads, account lookup elsewhere.
  const company = /\b(?:at|from|for)\s+((?:[A-Z0-9][\w&.'-]*)(?:\s+(?:[A-Z0-9][\w&.'-]*|&|of)){0,4})/.exec(rest)?.[1]?.trim();
  if (company) {
    const companyText = editable.find((f) => f.apiName === 'company' && f.type === 'text');
    const accountLookup = editable.find((f) => f.type === 'lookup' && f.referenceTo === 'account');
    if (companyText) fields.company = company;
    else if (accountLookup) {
      const acct = yield* findRecord(company, 'account');
      if (acct) fields[accountLookup.apiName] = acct.id;
      else notes.push(`I couldn't find an account named "${company}", so I left ${accountLookup.label} empty.`);
    }
  }
  // Picklist values ("priority high", "stage prospecting", "source referral").
  for (const f of editable.filter((x) => x.type === 'picklist')) {
    const labelled = new RegExp(String.raw`\b${esc(f.label.toLowerCase())}\s*(?:is|=|:|of)?\s+([a-z][\w -]{1,30}?)(?=$|[,;.]|\s+(?:and|with)\b)`).exec(restLower);
    const v = labelled ? matchOption(f, labelled[1]!) : (f.options ?? []).find((o) => o.value.length > 2 && wordRe(o.value, false).test(` ${restLower} `) && !Object.values(fields).includes(o.value))?.value;
    if (v && (labelled || f.apiName === def.statusField || /priority|stage|source|type|category|industry|rating/.test(f.apiName))) fields[f.apiName] = v;
  }
  // Dates ("closing next month", "due friday").
  const date = parseDate(restLower, ctx.now);
  if (date) {
    const df = editable.find((f) => (f.type === 'date' || f.type === 'datetime') && /close|due|start/.test(f.apiName)) ?? editable.find((f) => f.type === 'date');
    if (df) fields[df.apiName] = date;
  }
  // Generic "<field label> <value>" for simple text fields, e.g. "title VP Sales".
  for (const f of editable.filter((x) => (x.type === 'text' || x.type === 'url') && fields[x.apiName] === undefined && x.apiName !== def.nameField)) {
    const m = new RegExp(String.raw`\b${esc(f.label)}\s*(?:is|=|:)?\s+([^,;]+?)(?=$|[,;]|\s+and\b)`, 'i').exec(rest);
    if (m && m[1]!.trim().length > 1) fields[f.apiName] = m[1]!.trim();
  }
  if (!Object.keys(fields).length) return `Tell me a bit more about the ${def.label.toLowerCase()} — at least a name, e.g. \`create a ${def.label.toLowerCase()} named "…"\`.`;
  const missing = def.fields.filter((f) => f.required && f.defaultValue === undefined && isBlank(fields[f.apiName]) && f.type !== 'formula' && f.type !== 'rollup');
  if (missing.length) return `To create a ${def.label.toLowerCase()} I also need: ${missing.map((f) => `**${f.label}**`).join(', ')}.`;
  const out = yield* call('create_record', { object: def.apiName, fields });
  if (!out.ok) return `I couldn't create the ${def.label.toLowerCase()}: ${out.error}`;
  const r = out.result as Summary;
  return [pendingOr(out, `✅ Created ${def.label.toLowerCase()} ${link(r)}.`), ...notes].join('\n');
}

async function* updateRecord(ctx: BrainContext, text: string): BrainPlan {
  if (!ctx.tools.has('update_record')) return "I'm not allowed to update records.";
  const clean = text.trim().replace(/[.!?]+$/, '');
  let name: string | null = null;
  let value: string | null = null;
  let fieldLabel: string | null = null;
  let mode: 'status' | 'any' | 'owner' | 'field' | 'close' | 'escalate' = 'any';
  let m: RegExpExecArray | null;
  if ((m = /^(?:please\s+)?(?:mark|flag)\s+(.+?)\s+as\s+(.+)$/i.exec(clean))) [name, value] = [m[1]!, m[2]!];
  else if ((m = /^(?:please\s+)?(?:move|advance|progress)\s+(.+?)\s+to\s+(.+)$/i.exec(clean))) [name, value, mode] = [m[1]!, m[2]!, 'status'];
  else if ((m = /^(?:please\s+)?(?:re)?assign\s+(.+?)\s+to\s+(.+)$/i.exec(clean))) [name, value, mode] = [m[1]!, m[2]!, 'owner'];
  else if ((m = /^(?:please\s+)?(?:set|change|update)\s+(?:the\s+)?(.+?)\s+(?:of|on|for)\s+(.+?)\s+to\s+(.+)$/i.exec(clean))) [fieldLabel, name, value, mode] = [m[1]!, m[2]!, m[3]!, 'field'];
  else if ((m = /^(?:please\s+)?(?:set|change|update)\s+(.+?)\s+to\s+(.+)$/i.exec(clean))) {
    // "set Globex Renewal stage to Negotiation": the field label is the tail of the subject.
    const subject = m[1]!;
    let best: { label: string; name: string } | null = null;
    for (const def of ctx.metadata.list())
      for (const f of def.fields) {
        const re = new RegExp(String.raw`^(.+?)(?:'s)?\s+${esc(f.label)}$`, 'i');
        const mm = re.exec(subject);
        if (mm && (!best || f.label.length > best.label.length)) best = { label: f.label, name: mm[1]! };
      }
    if (best) [fieldLabel, name, value, mode] = [best.label, best.name, m[2]!, 'field'];
    else [name, value] = [subject, m[2]!];
  } else if ((m = /^(?:please\s+)?close\s+(.+)$/i.exec(clean))) [name, mode] = [m[1]!, 'close'];
  else if ((m = /^(?:please\s+)?escalate\s+(.+)$/i.exec(clean))) [name, mode] = [m[1]!, 'escalate'];
  if (!name) return 'Tell me what to change, e.g. `move "Globex Renewal" to Negotiation` or `set the priority of "Login error" to High`.';
  const hint = detectObject(ctx.metadata, name.toLowerCase());
  const t = yield* resolveTarget(ctx, text, hint?.apiName ?? null, cleanName(name));
  if (!t) return `I couldn't find "${cleanName(name) ?? name}".`;
  const def = ctx.metadata.get(t.object);
  if (!def) return `I can't update ${link(t)}.`;
  const status = def.statusField ? def.fields.find((f) => f.apiName === def.statusField) : undefined;
  const fields: Record<string, unknown> = {};
  if (mode === 'owner') {
    const user = findUser(ctx, value ?? '');
    if (!user) return `I couldn't find a user named "${value}".`;
    fields.owner_id = user.id;
  } else if (mode === 'close' || mode === 'escalate') {
    const opt =
      mode === 'close'
        ? (status?.options ?? []).find((o) => /^closed?$|^resolved$|^completed?$|^done$/i.test(o.value))?.value
        : (status?.options ?? []).find((o) => /escalat/i.test(o.value))?.value;
    if (status && opt) fields[status.apiName] = opt;
    else if (mode === 'escalate' && def.fields.some((f) => f.apiName === 'priority')) fields.priority = matchOption(def.fields.find((f) => f.apiName === 'priority')!, 'Urgent') ?? 'High';
    else return `I don't know how to ${mode} a ${def.label.toLowerCase()}.`;
  } else {
    const v = value!.replace(/^["“']|["”']$/g, '').trim();
    let f: FieldDef | null | undefined = fieldLabel ? fieldByLabel(def, fieldLabel) : mode === 'status' ? status : null;
    if (fieldLabel && !f && /^owner$/i.test(fieldLabel)) {
      const user = findUser(ctx, v);
      if (!user) return `I couldn't find a user named "${v}".`;
      fields.owner_id = user.id;
    } else {
      if (!f) {
        const picks = def.fields.filter((x) => x.type === 'picklist');
        f = (status && matchOption(status, v) ? status : undefined) ?? picks.find((x) => (x.options ?? []).some((o) => o.value.toLowerCase() === v.toLowerCase())) ?? null;
      }
      if (!f) return `I couldn't tell which ${def.label.toLowerCase()} field "${v}" belongs to. Try \`set the <field> of "${t.name}" to ${v}\`.`;
      if (f.type === 'formula' || f.type === 'rollup') return `${f.label} is calculated automatically and can't be set.`;
      let coerced: unknown = v;
      if (f.type === 'picklist') coerced = matchOption(f, v);
      else if (f.type === 'currency' || f.type === 'number' || f.type === 'percent') coerced = parseMoney(v);
      else if (f.type === 'date') coerced = parseDate(v.toLowerCase(), ctx.now);
      else if (f.type === 'checkbox') coerced = /^(yes|true|checked|on|1)$/i.test(v);
      else if (f.type === 'user') coerced = findUser(ctx, v)?.id ?? null;
      else if (f.type === 'lookup' && f.referenceTo && f.referenceTo !== '*') coerced = (yield* findRecord(v, f.referenceTo))?.id ?? null;
      if (coerced === null || coerced === undefined) {
        const allowed = f.type === 'picklist' ? ` Allowed values: ${(f.options ?? []).map((o) => o.value).join(', ')}.` : '';
        return `"${v}" isn't a valid ${f.label}.${allowed}`;
      }
      fields[f.apiName] = coerced;
    }
  }
  const out = yield* call('update_record', { id: t.id, fields });
  if (!out.ok) return `I couldn't update ${link(t)}: ${out.error}`;
  const changes = Object.entries(fields)
    .map(([k, v]) => {
      const f = def.fields.find((x) => x.apiName === k);
      const shown = k === 'owner_id' ? ctx.users.find((u) => u.id === v)?.name : f?.type === 'lookup' ? 'linked record' : formatValue(f, v);
      return `${f?.label ?? 'Owner'} → **${shown}**`;
    })
    .join(', ');
  return pendingOr(out, `✅ Updated ${link(t)}: ${changes}.`);
}

async function* myWork(ctx: BrainContext, lower: string): BrainPlan {
  if (!ctx.metadata.get('activity')) return 'Activities are not set up in this org.';
  const rules: FilterRule[] = [
    { field: 'owner_id', op: 'eq', value: 'CURRENT_USER' },
    { field: 'status', op: 'neq', value: 'Completed' },
  ];
  if (/\boverdue|past due|late\b/.test(lower)) rules.push({ field: 'due_date', op: 'lt', value: 'TODAY' });
  else if (/\btoday\b/.test(lower)) rules.push({ field: 'due_date', op: 'lte', value: 'TODAY' });
  else if (/\bthis week\b/.test(lower)) rules.push({ field: 'due_date', op: 'lte', value: isoDay(addDays(ctx.now, 7)) });
  const out = yield* call('query_records', { object: 'activity', filters: rules, sort_field: 'due_date', sort_dir: 'asc', limit: 20 });
  if (!out.ok) return `I couldn't load your tasks: ${out.error}`;
  const { total, records } = out.result as { total: number; records: Summary[] };
  if (!total) return /overdue/.test(lower) ? 'Nothing overdue — nice work! 🎉' : 'You have no open tasks. 🎉';
  const today = isoDay(ctx.now);
  const overdue = records.filter((r) => typeof r.due_date === 'string' && r.due_date < today);
  const dueToday = records.filter((r) => r.due_date === today);
  const later = records.filter((r) => !overdue.includes(r) && !dueToday.includes(r));
  const line = (r: Summary) => {
    const rel = r.related_to as { id: string; name: string | null } | undefined;
    return `- ${link(r)}${r.type ? ` · ${r.type}` : ''}${r.due_date ? ` · due ${r.due_date}` : ''}${rel?.name ? ` · ${link({ id: rel.id, name: rel.name })}` : ''}`;
  };
  const lines = [`You have **${total}** open task${total === 1 ? '' : 's'}${total > records.length ? ` (showing ${records.length})` : ''}.`];
  if (overdue.length) lines.push('', `**Overdue (${overdue.length})**`, ...overdue.map(line));
  if (dueToday.length) lines.push('', `**Due today (${dueToday.length})**`, ...dueToday.map(line));
  if (later.length) lines.push('', '**Upcoming**', ...later.map(line));
  return lines.join('\n');
}

async function* ptoBalance(ctx: BrainContext): BrainPlan {
  const emp = ctx.metadata.get('employee');
  if (!emp?.fields.some((f) => f.apiName === 'user')) return "I can't look up time-off balances in this org.";
  const out = yield* call('query_records', { object: 'employee', filters: [{ field: 'user', op: 'eq', value: 'CURRENT_USER' }], limit: 1 });
  const rec = out.ok ? (out.result as { records: Summary[] }).records[0] : undefined;
  if (!rec) return "I couldn't find an employee record linked to your user.";
  const bal = rec.pto_balance;
  return isBlank(bal) ? `Your employee record ${link(rec)} has no PTO balance recorded.` : `You have **${bal} days** of PTO remaining (${link(rec)}).`;
}

async function* pipeline(ctx: BrainContext, text: string): BrainPlan {
  const opp = ctx.metadata.get('opportunity');
  if (!opp || !ctx.tools.has('aggregate_records')) return "I can't analyze the pipeline here.";
  const stage = opp.fields.find((f) => f.apiName === 'stage');
  const closed = (stage?.options ?? []).map((o) => o.value).filter((v) => CLOSED_RE.test(v));
  const extra = yield* parseFilters(ctx, opp, text.replace(/\b(pipeline|forecast)\b/gi, ' '));
  const baseRules: FilterRule[] = [...(closed.length ? [{ field: 'stage', op: 'not_in' as const, value: closed }] : []), ...extra.rules.filter((r) => r.field !== 'stage')];
  const out = yield* call('aggregate_records', { object: 'opportunity', metric: 'sum', field: 'amount', group_by: 'stage', filters: baseRules });
  if (!out.ok) return `I couldn't compute the pipeline: ${out.error}`;
  const res = out.result as ReportResult;
  const lines = [`**Open pipeline: ${formatMetric(res, res.total)}**${extra.notes.length ? ` (${extra.notes.filter((n) => !n.startsWith('Stage')).join('; ')})` : ''}`];
  for (const r of res.rows) lines.push(`- ${r.label}: ${formatMetric(res, r.value)}`);
  if (opp.fields.some((f) => f.apiName === 'expected_revenue')) {
    const w = yield* call('aggregate_records', { object: 'opportunity', metric: 'sum', field: 'expected_revenue', filters: baseRules });
    if (w.ok) lines.push('', `Weighted (amount × probability): **${formatMetric(w.result as ReportResult, (w.result as ReportResult).total)}**`);
  }
  const cnt = yield* call('aggregate_records', { object: 'opportunity', metric: 'count', filters: baseRules });
  if (cnt.ok) lines.push(`Open deals: **${(cnt.result as ReportResult).total}**`);
  return lines.join('\n');
}

async function* aggregate(ctx: BrainContext, text: string, lower: string, def: ObjectDef): BrainPlan {
  const fn = /\b(average|avg|mean)\b/.test(lower)
    ? 'avg'
    : /\b(total|sum)\b/.test(lower)
      ? 'sum'
      : /\b(max(imum)?|largest|highest|biggest)\b/.test(lower)
        ? 'max'
        : /\b(min(imum)?|smallest|lowest)\b/.test(lower)
          ? 'min'
          : 'count';
  const metricField = fn === 'count' ? null : primaryAmountField(def, lower);
  const metric = metricField ? fn : 'count';
  let groupBy: { field: string; interval?: string; label: string } | null = null;
  const by = /\b(?:by|per|for each|grouped by|broken down by)\s+([a-z][a-z _-]{1,40}?)(?=$|[?.!,]|\s+(?:for|in|this|last|next|with|where|that|over|under)\b)/.exec(lower);
  if (by) {
    const g = by[1]!.trim();
    if (/^(owner|rep|sales ?rep|user|person)s?$/.test(g)) groupBy = { field: 'owner_id', label: 'Owner' };
    else if (/^(day|month|quarter|year)s?$/.test(g)) {
      const df = dateFieldFor(def, lower);
      groupBy = { field: df.field, interval: g.replace(/s$/, ''), label: g };
    } else {
      const f = def.fields.filter((x) => !x.sensitive).find((x) => x.label.toLowerCase() === g || x.apiName === g.replace(/\s+/g, '_') || x.label.toLowerCase().startsWith(g) || g.startsWith(x.label.toLowerCase()));
      if (f && f.type !== 'longtext') groupBy = { field: f.apiName, interval: f.type === 'date' || f.type === 'datetime' ? 'month' : undefined, label: f.label };
    }
  }
  const filters = yield* parseFilters(ctx, def, by ? text.replace(new RegExp(esc(by[0]!), 'i'), ' ') : text);
  const out = yield* call('aggregate_records', {
    object: def.apiName,
    metric,
    field: metricField?.apiName,
    group_by: groupBy?.field,
    interval: groupBy?.interval,
    filters: filters.rules.filter((r) => r.field !== groupBy?.field || r.op !== 'eq'),
  });
  if (!out.ok) return `I couldn't compute that: ${out.error}`;
  const res = out.result as ReportResult;
  const what = metric === 'count' ? def.pluralLabel.toLowerCase() : `${{ sum: 'total', avg: 'average', max: 'maximum', min: 'minimum' }[metric as 'sum']} ${metricField!.label.toLowerCase()}`;
  const scope = filters.notes.length ? ` (${filters.notes.join('; ')})` : '';
  if (!groupBy) {
    return metric === 'count'
      ? `There ${res.total === 1 ? 'is' : 'are'} **${res.total.toLocaleString('en-US')}** ${res.total === 1 ? def.label.toLowerCase() : def.pluralLabel.toLowerCase()}${scope}.`
      : `The ${what} is **${formatMetric(res, res.total)}**${scope}.`;
  }
  const lines = [`${cap(what)} by ${groupBy.label.toLowerCase()}${scope}:`];
  for (const r of res.rows.slice(0, 20)) lines.push(`- ${r.label}: **${formatMetric(res, r.value)}**`);
  if (metric === 'count' || metric === 'sum') lines.push(`- Total: **${formatMetric(res, res.total)}**`);
  return lines.join('\n');
}

async function* findRecords(ctx: BrainContext, text: string, lower: string, def: ObjectDef): BrainPlan {
  const filters = yield* parseFilters(ctx, def, text);
  const topN = /\b(?:top|first|show(?: me)?|list|latest|last)\s+(\d{1,2})\b/.exec(lower);
  const limit = Math.min(Number(topN?.[1] ?? 10) || 10, 25);
  let sort: { field: string; dir: 'asc' | 'desc' } | null = null;
  const amount = primaryAmountField(def, lower);
  if (/\b(top|largest|biggest|highest|most valuable)\b/.test(lower) && amount) sort = { field: amount.apiName, dir: 'desc' };
  else if (/\b(smallest|lowest)\b/.test(lower) && amount) sort = { field: amount.apiName, dir: 'asc' };
  else if (/\b(newest|latest|recent|most recent)\b/.test(lower)) sort = { field: 'created_at', dir: 'desc' };
  else if (/\b(oldest)\b/.test(lower)) sort = { field: 'created_at', dir: 'asc' };
  else if (/\b(soonest|next|upcoming|closing soon)\b/.test(lower)) {
    const df = dateFieldFor(def, lower);
    sort = { field: df.field, dir: 'asc' };
  }
  const out = yield* call('query_records', { object: def.apiName, filters: filters.rules, sort_field: sort?.field, sort_dir: sort?.dir, limit });
  if (!out.ok) return `I couldn't search ${def.pluralLabel.toLowerCase()}: ${out.error}`;
  const { total, records } = out.result as { total: number; records: Summary[] };
  const scope = filters.notes.length ? ` (${filters.notes.join('; ')})` : '';
  if (!total) return `No ${def.pluralLabel.toLowerCase()} found${scope}.`;
  const lines = [`Found **${total}** ${total === 1 ? def.label.toLowerCase() : def.pluralLabel.toLowerCase()}${scope}${total > records.length ? ` — showing ${records.length}` : ''}:`];
  for (const r of records) lines.push(recordLine(def, r));
  return lines.join('\n');
}

async function* knowledge(text: string): BrainPlan {
  const out = yield* call('search_knowledge', { query: text });
  const articles = out.ok ? (out.result as { id: string; title: string; summary: string }[]) : [];
  if (!articles.length) return "I couldn't find a knowledge article about that. You may want to create one once the question is answered.";
  const [first, ...more] = articles;
  const lines = [`From the knowledge base — **${link({ id: first!.id, name: first!.title })}**:`, '', `> ${first!.summary.replace(/\n+/g, ' ').slice(0, 350)}${first!.summary.length > 350 ? '…' : ''}`];
  if (more.length) lines.push('', `Related: ${more.map((a) => link({ id: a.id, name: a.title })).join(', ')}`);
  return lines.join('\n');
}

async function* fallback(ctx: BrainContext, text: string): BrainPlan {
  const terms = text
    .replace(/[^\p{L}\p{N}@.\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ');
  if (terms && ctx.tools.has('search_records')) {
    const out = yield* call('search_records', { query: terms });
    const groups = out.ok ? (out.result as SearchResultGroup[]) : [];
    if (groups.length) {
      const lines = [`Here's what I found for "${terms}":`];
      for (const g of groups.slice(0, 5)) for (const r of g.records.slice(0, 3)) lines.push(`- ${link(r)} · ${ctx.metadata.get(g.object)?.label ?? g.object}${r.subtitle ? ` — ${r.subtitle}` : ''}`);
      return lines.join('\n');
    }
  }
  return `I'm not sure how to help with that yet.\n\n${help(ctx)}`;
}

const FILLER = new Set(['the', 'and', 'for', 'with', 'show', 'find', 'list', 'get', 'please', 'what', 'who', 'where', 'can', 'you', 'about', 'any', 'all', 'some', 'tell', 'give', 'look', 'search', 'have', 'there', 'are', 'is']);

// ---------- entry point ----------

export async function* plan(input: string, ctx: BrainContext): BrainPlan {
  const text = input.trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const obj = detectObject(ctx.metadata, lower);
  if (!text || /^(hi|hello|hey|help|yo|\?|what can you do\??|what do you do\??|who are you\??)[!. ]*$/.test(lower) || /\bwhat can you (do|help)\b/.test(lower)) return help(ctx);
  if (/\b(qualify|score|rate)\b/.test(lower) && (obj?.apiName === 'lead' || /\blead/.test(lower) || (ctx.recordId?.startsWith('led') ?? false))) return yield* qualifyLeads(ctx, text, lower);
  if (/\btriage\b/.test(lower) || (/\b(prioriti[sz]e|categori[sz]e|classify)\b/.test(lower) && (obj?.apiName === 'case' || /\b(case|ticket)/.test(lower)))) return yield* triageCases(ctx, text, lower);
  if (/^(please\s+)?convert\b/.test(lower)) return yield* convertLead(ctx, text);
  if (/\b(summari[sz]e|summary|brief me|tell me about|overview of|catch me up|what'?s (going on|happening) with|status of|coach me|next steps? for)\b/.test(lower) || /^(please\s+)?(review|analy[sz]e|assess)\b/.test(lower))
    return yield* summarize(ctx, text, lower);
  if (/^(please\s+)?(log|record)\b/.test(lower) || /\bremind me\b/.test(lower) || /^(please\s+)?(schedule|add|create|set up|book) (a |an )?(call|meeting|task|follow[- ]?up|note|reminder|to-?do)\b/.test(lower) || /^(please\s+)?(add|leave) (a |an )?note\b/.test(lower))
    return yield* logActivity(ctx, text, lower);
  if (/^(please\s+)?(create|add|make|register)\b|^(please\s+)?new\s|^(please\s+)?open (a|an|new) /.test(lower)) return yield* createRecord(ctx, text, lower);
  if (/^(please\s+)?(set|update|change|mark|flag|move|advance|assign|reassign|close|escalate)\b/.test(lower)) return yield* updateRecord(ctx, text);
  if (/\b(pto|vacation|time off|leave)\b/.test(lower) && /\b(balance|left|remaining|do i have|how many days)\b/.test(lower)) return yield* ptoBalance(ctx);
  if (/\b(my (tasks|to-?dos|activities|day|agenda|follow[- ]?ups)|on my plate|what('?s| is) (overdue|due)|am i (behind|late))\b/.test(lower) || (/\boverdue\b/.test(lower) && (!obj || obj.apiName === 'activity')))
    return yield* myWork(ctx, lower);
  if (/\b(how many|count|number of|total|sum of|average|avg|mean|maximum|minimum)\b/.test(lower) && obj && ctx.tools.has('aggregate_records')) {
    if (obj.apiName === 'opportunity' && /\b(pipeline|forecast)\b/.test(lower) && !/\b(how many|count|number of|by)\b/.test(lower)) return yield* pipeline(ctx, text);
    return yield* aggregate(ctx, text, lower, obj);
  }
  if (/\b(pipeline|forecast)\b/.test(lower)) return yield* pipeline(ctx, text);
  if (ctx.metadata.get('knowledge_article') && ctx.tools.has('search_knowledge') && (/^(how|why|can i|is there|what is|what's|where)\b/.test(lower) || obj?.apiName === 'knowledge_article') && (!obj || obj.apiName === 'knowledge_article'))
    return yield* knowledge(text);
  if (obj && ctx.tools.has('query_records')) return yield* findRecords(ctx, text, lower, obj);
  return yield* fallback(ctx, text);
}

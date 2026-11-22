import { type CrmRecord, type FieldDef, type FieldType, numberFormat, type ObjectDef, type RefMap } from '@titoforce/shared';
import { intlLocale, type MessageKey, t } from '../i18n/index.ts';

type NumberKind = 'currency' | 'percent' | 'number';

// Labels are message keys, translated when a definition is requested so they follow the active language.
const SYSTEM_DEFS: Record<string, { label: MessageKey; type: FieldType }> = {
  owner_id: { label: 'common.owner', type: 'user' },
  created_at: { label: 'common.created', type: 'datetime' },
  updated_at: { label: 'common.lastModified', type: 'datetime' },
  created_by: { label: 'common.createdBy', type: 'user' },
  updated_by: { label: 'common.lastModifiedBy', type: 'user' },
  id: { label: 'common.recordId', type: 'text' },
};

/** Field definition for any column, including system columns (name, owner_id, created_at, …). */
export function fieldDef(def: ObjectDef, apiName: string): FieldDef | undefined {
  const f = def.fields.find((x) => x.apiName === apiName);
  if (f) return f;
  if (apiName === 'name') {
    const nameField = def.nameTemplate ? undefined : def.fields.find((x) => x.apiName === def.nameField);
    return { apiName: 'name', label: nameField?.label ?? t('common.name'), type: 'text' };
  }
  const sys = SYSTEM_DEFS[apiName];
  return sys ? { apiName, label: t(sys.label), type: sys.type } : undefined;
}

export function valueOf(record: CrmRecord, apiName: string): unknown {
  switch (apiName) {
    case 'id':
      return record.id;
    case 'name':
      return record.name;
    case 'owner_id':
      return record.ownerId;
    case 'created_at':
      return record.createdAt;
    case 'updated_at':
      return record.updatedAt;
    case 'created_by':
      return record.createdBy;
    case 'updated_by':
      return record.updatedBy;
    default:
      return record.fields[apiName];
  }
}

/** Fields a user can type into (formulas, roll-ups and the computed name are read-only). */
export function isEditable(def: ObjectDef, f: FieldDef): boolean {
  if (f.type === 'formula' || f.type === 'rollup') return false;
  if (f.apiName === 'name' && (def.nameTemplate || def.nameField !== 'name')) return false;
  return true;
}

export function listColumns(def: ObjectDef, columns?: string[] | null): string[] {
  const cols = columns?.length ? columns : def.listFields?.length ? def.listFields : ['name', ...def.fields.filter((f) => f.apiName !== 'name').slice(0, 5).map((f) => f.apiName)];
  return cols.filter((c) => fieldDef(def, c));
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = intlLocale();
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    numberFormats.set(key, f);
  }
  return f;
}

export function formatNumber(n: number, kind: NumberKind = 'number', precision?: number): string {
  if (!Number.isFinite(n)) return '';
  const digits = precision ?? (Number.isInteger(n) ? 0 : 2);
  if (kind === 'currency') return nf({ style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  if (kind === 'percent') return `${nf({ maximumFractionDigits: precision ?? 1 }).format(n)}%`;
  return nf({ maximumFractionDigits: precision ?? 2 }).format(n);
}

/** Short form for KPIs and chart axes: $1.2M, 45%, 12.3K. */
export function formatCompact(n: number, kind: NumberKind = 'number'): string {
  if (!Number.isFinite(n)) return '';
  if (kind === 'percent') return `${nf({ maximumFractionDigits: 1 }).format(n)}%`;
  const maximumFractionDigits = Math.abs(n) >= 1000 ? 1 : 0;
  // The currency style places the symbol and sign where the locale expects them ("$1.2M", "1,2 M US$", "-$1.2M").
  if (kind === 'currency') return nf({ style: 'currency', currency: 'USD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits }).format(n);
  return nf({ notation: 'compact', maximumFractionDigits }).format(n);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date-only values are calendar dates, so they are parsed in local time to avoid off-by-one days. */
export function parseDate(s: string): Date | null {
  const m = DATE_ONLY.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const todayIso = () => toDateInput(new Date());

export function addDays(iso: string, days: number): string {
  const d = parseDate(iso) ?? new Date();
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}

export function formatDate(s: string): string {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric', year: 'numeric' }) : s;
}

export function formatDateTime(s: string): string {
  const d = parseDate(s);
  return d ? d.toLocaleString(intlLocale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : s;
}

export function relativeTime(s: string, now = Date.now()): string {
  const d = parseDate(s);
  if (!d) return s;
  const sec = Math.round((now - d.getTime()) / 1000);
  if (sec < 45) return t('format.justNow');
  const min = Math.round(sec / 60);
  if (min < 60) return t('format.minutesAgo', { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('format.hoursAgo', { count: hr });
  const day = Math.round(hr / 24);
  if (day < 7) return t('format.daysAgo', { count: day });
  return formatDate(s);
}

/** Display text of a picklist value: its translation when the server sent one, else the stored value. */
export function optionLabel(f: Pick<FieldDef, 'options'> | undefined, value: unknown): string {
  return f?.options?.find((o) => o.value === value)?.label ?? String(value);
}

/** Plain-text rendering of a field value. */
export function formatValue(f: FieldDef | undefined, v: unknown, refs?: RefMap): string {
  if (v === null || v === undefined || v === '') return '';
  if (!f) return Array.isArray(v) ? v.join(', ') : String(v);
  const kind = numberFormat(f);
  if (kind && typeof v === 'number') return formatNumber(v, kind, f.precision);
  const type = f.type === 'formula' ? (f.formulaType ?? 'text') : f.type;
  switch (type) {
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    case 'checkbox':
      return v ? t('common.yes') : t('common.no');
    case 'picklist':
      return optionLabel(f, v);
    case 'multipicklist':
      return (Array.isArray(v) ? v : [v]).map((x) => optionLabel(f, x)).join(', ');
    case 'lookup':
    case 'user':
      return refs?.[String(v)]?.name ?? String(v);
    default:
      return Array.isArray(v) ? v.join(', ') : String(v);
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;

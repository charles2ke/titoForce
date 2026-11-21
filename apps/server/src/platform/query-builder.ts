import { endOfDay, type FieldDef, type FilterGroup, type FilterRule, isBlank, type ObjectDef, resolveDateLiteral, type SortSpec } from '@titoforce/shared';
import { type Db, jsonArrayContains, jsonBool, jsonNumber, jsonText, type SqlParam } from '../db/database.ts';
import { badRequest } from '../util.ts';

export type FieldKind = 'text' | 'number' | 'bool' | 'date' | 'multi';

export interface FieldExpr {
  expr: string;
  textExpr: string;
  kind: FieldKind;
  field?: FieldDef;
}

export interface BuildContext {
  db: Pick<Db, 'dialect'>;
  def: ObjectDef;
  currentUserId: string | null;
  now: Date;
}

const COLUMN_FIELDS: Record<string, FieldKind> = {
  id: 'text',
  name: 'text',
  owner_id: 'text',
  created_by: 'text',
  updated_by: 'text',
  created_at: 'date',
  updated_at: 'date',
};

export function kindOf(f: FieldDef): FieldKind {
  switch (f.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rollup':
      return 'number';
    case 'checkbox':
      return 'bool';
    case 'date':
    case 'datetime':
      return 'date';
    case 'multipicklist':
      return 'multi';
    case 'formula':
      return f.formulaType === 'checkbox' ? 'bool' : f.formulaType === 'date' ? 'date' : f.formulaType === 'text' ? 'text' : 'number';
    default:
      return 'text';
  }
}

export function fieldExpr(db: Pick<Db, 'dialect'>, def: ObjectDef, fieldName: string): FieldExpr {
  const columnKind = COLUMN_FIELDS[fieldName];
  if (columnKind) {
    const col = `records.${fieldName}`;
    return { expr: col, textExpr: col, kind: columnKind };
  }
  const field = def.fields.find((f) => f.apiName === fieldName);
  if (!field) throw badRequest(`Unknown field "${fieldName}" on ${def.label}`);
  const text = jsonText(db, field.apiName, 'records.data');
  const kind = kindOf(field);
  const expr = kind === 'number' ? jsonNumber(db, field.apiName, 'records.data') : kind === 'bool' ? jsonBool(db, field.apiName, 'records.data') : text;
  return { expr, textExpr: text, kind, field };
}

export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const LIKE = `LIKE ? ESCAPE '\\'`;
const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

interface Sql {
  sql: string;
  params: SqlParam[];
}

export function ruleSql(ctx: BuildContext, rule: FilterRule): Sql {
  const fe = fieldExpr(ctx.db, ctx.def, rule.field);
  const value = rule.value === 'CURRENT_USER' ? ctx.currentUserId : rule.value;
  const empty = fe.kind === 'multi' ? `(${fe.textExpr} IS NULL OR ${fe.textExpr} = '[]')` : `(${fe.textExpr} IS NULL OR ${fe.textExpr} = '')`;
  const op = rule.op;
  if (op === 'is_empty' || (op === 'eq' && isBlank(value))) return { sql: empty, params: [] };
  if (op === 'is_not_empty' || (op === 'neq' && isBlank(value))) return { sql: `NOT ${empty}`, params: [] };
  const values = (Array.isArray(value) ? value : [value]).filter((v) => !isBlank(v));
  if (!values.length) throw badRequest(`Filter on ${rule.field} needs a value`);
  const unsupported = () => badRequest(`Operator "${op}" is not supported for ${rule.field}`);

  switch (fe.kind) {
    case 'multi': {
      const vals = values.map((v) => String(v).toLowerCase());
      const any = `(${vals.map(() => jsonArrayContains(ctx.db, fe.field!.apiName, 'records.data')).join(' OR ')})`;
      if (op === 'eq' || op === 'contains' || op === 'in') return { sql: any, params: vals };
      if (op === 'neq' || op === 'not_contains' || op === 'not_in') return { sql: `NOT ${any}`, params: vals };
      throw unsupported();
    }
    case 'bool': {
      const b = values[0] === true || values[0] === 'true' || values[0] === 1 || values[0] === '1' ? 1 : 0;
      if (op === 'eq') return { sql: `${fe.expr} = ?`, params: [b] };
      if (op === 'neq') return { sql: `${fe.expr} <> ?`, params: [b] };
      throw unsupported();
    }
    case 'number': {
      const nums = values.map((v) => Number(v));
      if (nums.some((n) => !Number.isFinite(n))) throw badRequest(`Filter on ${rule.field} expects a number`);
      const e = fe.expr;
      switch (op) {
        case 'eq':
          return { sql: `${e} = ?`, params: [nums[0]!] };
        case 'neq':
          return { sql: `(${e} IS NULL OR ${e} <> ?)`, params: [nums[0]!] };
        case 'gt':
          return { sql: `${e} > ?`, params: [nums[0]!] };
        case 'gte':
          return { sql: `${e} >= ?`, params: [nums[0]!] };
        case 'lt':
          return { sql: `${e} < ?`, params: [nums[0]!] };
        case 'lte':
          return { sql: `${e} <= ?`, params: [nums[0]!] };
        case 'in':
          return { sql: `${e} IN (${marks(nums.length)})`, params: nums };
        case 'not_in':
          return { sql: `(${e} IS NULL OR ${e} NOT IN (${marks(nums.length)}))`, params: nums };
        default:
          throw unsupported();
      }
    }
    case 'date': {
      const v = values[0];
      const e = fe.expr;
      const range =
        resolveDateLiteral(v, ctx.now) ?? (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? { start: v, end: v } : null);
      if (range) {
        switch (op) {
          case 'eq':
            return { sql: `(${e} >= ? AND ${e} <= ?)`, params: [range.start, endOfDay(range.end)] };
          case 'neq':
            return { sql: `(${e} IS NULL OR ${e} < ? OR ${e} > ?)`, params: [range.start, endOfDay(range.end)] };
          case 'gt':
            return { sql: `${e} > ?`, params: [endOfDay(range.end)] };
          case 'gte':
            return { sql: `${e} >= ?`, params: [range.start] };
          case 'lt':
            return { sql: `${e} < ?`, params: [range.start] };
          case 'lte':
            return { sql: `${e} <= ?`, params: [endOfDay(range.end)] };
          default:
            throw unsupported();
        }
      }
      const s = String(v);
      const cmp: Record<string, string> = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (cmp[op]) return { sql: `${e} ${cmp[op]} ?`, params: [s] };
      if (op === 'neq') return { sql: `(${e} IS NULL OR ${e} <> ?)`, params: [s] };
      throw unsupported();
    }
    default: {
      const e = fe.expr;
      const vals = values.map((x) => String(x).toLowerCase());
      switch (op) {
        case 'eq':
          return { sql: `LOWER(${e}) = ?`, params: [vals[0]!] };
        case 'neq':
          return { sql: `(${e} IS NULL OR LOWER(${e}) <> ?)`, params: [vals[0]!] };
        case 'contains':
          return { sql: `LOWER(${e}) ${LIKE}`, params: [`%${likeEscape(vals[0]!)}%`] };
        case 'not_contains':
          return { sql: `(${e} IS NULL OR LOWER(${e}) NOT ${LIKE})`, params: [`%${likeEscape(vals[0]!)}%`] };
        case 'starts_with':
          return { sql: `LOWER(${e}) ${LIKE}`, params: [`${likeEscape(vals[0]!)}%`] };
        case 'in':
          return { sql: `LOWER(${e}) IN (${marks(vals.length)})`, params: vals };
        case 'not_in':
          return { sql: `(${e} IS NULL OR LOWER(${e}) NOT IN (${marks(vals.length)}))`, params: vals };
        case 'gt':
          return { sql: `${e} > ?`, params: [String(values[0])] };
        case 'gte':
          return { sql: `${e} >= ?`, params: [String(values[0])] };
        case 'lt':
          return { sql: `${e} < ?`, params: [String(values[0])] };
        case 'lte':
          return { sql: `${e} <= ?`, params: [String(values[0])] };
        default:
          throw unsupported();
      }
    }
  }
}

export function filterSql(ctx: BuildContext, group: FilterGroup | null | undefined): Sql {
  if (!group?.rules?.length) return { sql: '1 = 1', params: [] };
  if (group.rules.length > 50) throw badRequest('Too many filter rules (max 50)');
  const parts = group.rules.map((r) => ruleSql(ctx, r));
  return {
    sql: `(${parts.map((p) => p.sql).join(group.match === 'any' ? ' OR ' : ' AND ')})`,
    params: parts.flatMap((p) => p.params),
  };
}

export function sortSql(ctx: BuildContext, sort: SortSpec): string {
  const fe = fieldExpr(ctx.db, ctx.def, sort.field);
  const dir = sort.dir === 'asc' ? 'ASC' : 'DESC';
  const expr = fe.kind === 'text' ? `LOWER(${fe.expr})` : fe.expr;
  return `${expr} ${dir} NULLS LAST, records.id ${dir}`;
}

/** Splits free text into up to five lower-cased LIKE terms that must all match search_text. */
export function searchTermsSql(text: string): Sql {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!terms.length) return { sql: '1 = 1', params: [] };
  return { sql: terms.map(() => `records.search_text ${LIKE}`).join(' AND '), params: terms.map((t) => `%${likeEscape(t)}%`) };
}

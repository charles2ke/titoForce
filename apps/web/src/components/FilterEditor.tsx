import { DATE_LITERALS, type FieldDef, type FilterGroup, type FilterOperator, type FilterRule, type ObjectDef, OPERATOR_LABELS } from '@titoforce/shared';
import { Plus, Trash } from 'lucide-react';
import { t, tryT } from '../i18n/index.ts';
import { fieldDef } from '../lib/format.ts';
import { LookupInput, UserSelect } from './FieldInput.tsx';
import { Button, IconButton } from './ui.tsx';

type Kind = 'text' | 'number' | 'date' | 'bool' | 'picklist' | 'multi' | 'ref' | 'user';

const SYSTEM_COLUMNS = ['name', 'owner_id', 'created_at', 'updated_at', 'created_by'];

function kindOf(f: FieldDef): Kind {
  switch (f.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rollup':
      return 'number';
    case 'date':
    case 'datetime':
      return 'date';
    case 'checkbox':
      return 'bool';
    case 'picklist':
      return 'picklist';
    case 'multipicklist':
      return 'multi';
    case 'lookup':
      return 'ref';
    case 'user':
      return 'user';
    case 'formula':
      return f.formulaType === 'checkbox' ? 'bool' : f.formulaType === 'date' ? 'date' : f.formulaType === 'text' ? 'text' : 'number';
    default:
      return 'text';
  }
}

const OPS: Record<Kind, FilterOperator[]> = {
  text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  bool: ['eq', 'neq'],
  picklist: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multi: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  ref: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  user: ['eq', 'neq', 'is_empty', 'is_not_empty'],
};

const humanize = (literal: string) => literal.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
// Operators and date literals may come from saved filters; ones without a message fall back to their English names.
const dateLabel = (literal: string) => tryT(`filters.dates.${literal}`) ?? humanize(literal);
const operatorLabel = (op: string) => tryT(`filters.operators.${op}`) ?? OPERATOR_LABELS[op] ?? op;

export function filterableFields(def: ObjectDef): FieldDef[] {
  // "name" only adds something when it is computed from a template; otherwise it duplicates the name field.
  const nameIsField = !def.nameTemplate && def.fields.some((x) => x.apiName === def.nameField);
  const sys = SYSTEM_COLUMNS.filter((c) => !(c === 'name' && nameIsField))
    .map((c) => fieldDef(def, c)!)
    .filter((f) => !def.fields.some((x) => x.apiName === f.apiName));
  return [...def.fields, ...sys];
}

function defaultValue(kind: Kind, f: FieldDef): unknown {
  if (kind === 'bool') return true;
  if (kind === 'picklist') return f.options?.[0]?.value ?? '';
  if (kind === 'multi') return f.options?.[0]?.value ?? '';
  if (kind === 'user') return 'CURRENT_USER';
  if (kind === 'date') return 'THIS_MONTH';
  return '';
}

function ValueInput({ field, rule, onChange }: { field: FieldDef; rule: FilterRule; onChange: (v: unknown) => void }) {
  const kind = kindOf(field);
  if (rule.op === 'is_empty' || rule.op === 'is_not_empty') return <div className="flex-1" />;
  const v = rule.value;
  const cls = 'input flex-1 min-w-0';
  if (kind === 'bool') {
    return (
      <select aria-label={t('common.value')} className={cls} value={String(v === true || v === 'true')} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">{t('filters.valueTrue')}</option>
        <option value="false">{t('filters.valueFalse')}</option>
      </select>
    );
  }
  if (kind === 'picklist' || kind === 'multi') {
    if (rule.op === 'in' || rule.op === 'not_in') {
      const selected = Array.isArray(v) ? (v as string[]) : v ? [String(v)] : [];
      return (
        <div className="flex flex-1 flex-wrap gap-1">
          {field.options?.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value])}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600'}`}
              >
                {o.label ?? o.value}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <select aria-label={t('common.value')} className={cls} value={String(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))} onChange={(e) => onChange(e.target.value)}>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    );
  }
  if (kind === 'date') {
    const literal = typeof v === 'string' && (DATE_LITERALS as readonly string[]).includes(v);
    return (
      <div className="flex flex-1 gap-1.5">
        <select aria-label={t('filters.dateValue')} className="input w-40" value={literal ? String(v) : 'DATE'} onChange={(e) => onChange(e.target.value === 'DATE' ? '' : e.target.value)}>
          <option value="DATE">{t('filters.specificDate')}</option>
          {DATE_LITERALS.map((l) => (
            <option key={l} value={l}>
              {dateLabel(l)}
            </option>
          ))}
        </select>
        {!literal && <input aria-label={t('common.date')} type="date" className="input min-w-0 flex-1" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />}
      </div>
    );
  }
  if (kind === 'user') {
    return (
      <div className="flex flex-1 gap-1.5">
        <select aria-label={t('filters.userValue')} className="input w-36" value={v === 'CURRENT_USER' ? 'CURRENT_USER' : 'USER'} onChange={(e) => onChange(e.target.value === 'CURRENT_USER' ? 'CURRENT_USER' : '')}>
          <option value="CURRENT_USER">{t('filters.currentUser')}</option>
          <option value="USER">{t('filters.specificUser')}</option>
        </select>
        {v !== 'CURRENT_USER' && (
          <div className="min-w-0 flex-1">
            <UserSelect value={(v as string) || null} onChange={(id) => onChange(id ?? '')} emptyLabel={t('common.choose')} />
          </div>
        )}
      </div>
    );
  }
  if (kind === 'ref') {
    return (
      <div className="min-w-0 flex-1">
        <LookupInput referenceTo={field.referenceTo ?? '*'} value={(v as string) || null} onChange={(id) => onChange(id ?? '')} />
      </div>
    );
  }
  return <input aria-label={t('common.value')} type={kind === 'number' ? 'number' : 'text'} className={cls} value={String(v ?? '')} onChange={(e) => onChange(kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />;
}

/** Builds a FilterGroup ("all"/"any" of a list of field conditions). */
export function FilterEditor({ def, value, onChange }: { def: ObjectDef; value: FilterGroup | null; onChange: (g: FilterGroup | null) => void }) {
  const group: FilterGroup = value ?? { match: 'all', rules: [] };
  const base = filterableFields(def);
  // Keep rules on columns outside the default list (e.g. "name") editable.
  const extra = [...new Set(group.rules.map((r) => r.field))].filter((n) => !base.some((f) => f.apiName === n)).flatMap((n) => fieldDef(def, n) ?? []);
  const fields = [...base, ...extra];
  const update = (rules: FilterRule[], match = group.match) => onChange(rules.length ? { match, rules } : null);
  const fieldFor = (name: string) => fields.find((f) => f.apiName === name);

  const addRule = () => {
    const f = fields.find((x) => x.type === 'picklist') ?? fields[0]!;
    const kind = kindOf(f);
    update([...group.rules, { field: f.apiName, op: OPS[kind][0]!, value: defaultValue(kind, f) }]);
  };

  return (
    <div className="space-y-2">
      {group.rules.length > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          {t('filters.match')}
          <select aria-label={t('filters.match')} className="input w-auto py-1" value={group.match} onChange={(e) => update(group.rules, e.target.value as 'all' | 'any')}>
            <option value="all">{t('filters.matchAll')}</option>
            <option value="any">{t('filters.matchAny')}</option>
          </select>
        </div>
      )}
      {group.rules.map((rule, i) => {
        const f = fieldFor(rule.field);
        const kind = f ? kindOf(f) : 'text';
        const ops = OPS[kind];
        const set = (patch: Partial<FilterRule>) => update(group.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <select
              aria-label={t('common.field')}
              className="input w-44"
              value={rule.field}
              onChange={(e) => {
                const nf = fieldFor(e.target.value)!;
                const nk = kindOf(nf);
                set({ field: nf.apiName, op: OPS[nk][0]!, value: defaultValue(nk, nf) });
              }}
            >
              {fields.map((x) => (
                <option key={x.apiName} value={x.apiName}>
                  {x.label}
                </option>
              ))}
            </select>
            <select aria-label={t('filters.operator')} className="input w-40" value={ops.includes(rule.op) ? rule.op : ops[0]} onChange={(e) => set({ op: e.target.value as FilterOperator })}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {operatorLabel(o)}
                </option>
              ))}
            </select>
            {f && <ValueInput field={f} rule={rule} onChange={(v) => set({ value: v })} />}
            <IconButton icon={Trash} label={t('filters.removeCondition')} onClick={() => update(group.rules.filter((_, j) => j !== i))} />
          </div>
        );
      })}
      <Button size="sm" variant="ghost" icon={Plus} onClick={addRule}>
        {t('filters.addCondition')}
      </Button>
    </div>
  );
}

const isBlankValue = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Drops conditions that are still missing a value, so half-typed rules don't filter everything out. */
export function completeFilter(g: FilterGroup | null | undefined): FilterGroup | null {
  const rules = (g?.rules ?? []).filter((r) => r.op === 'is_empty' || r.op === 'is_not_empty' || !isBlankValue(r.value));
  return g && rules.length ? { ...g, rules } : null;
}

export function describeFilter(def: ObjectDef, g: FilterGroup | null | undefined): string {
  if (!g?.rules.length) return t('filters.noConditions');
  return g.rules
    .map((r) => {
      const field = fieldDef(def, r.field)?.label ?? r.field;
      const operator = operatorLabel(r.op);
      if (r.op === 'is_empty' || r.op === 'is_not_empty') return t('filters.describe.ruleNoValue', { field, operator });
      const value = Array.isArray(r.value) ? r.value.join(', ') : r.value === 'CURRENT_USER' ? t('filters.me') : String(r.value ?? '');
      return t('filters.describe.rule', { field, operator, value });
    })
    .reduce((left, right) => t(g.match === 'all' ? 'filters.describe.and' : 'filters.describe.or', { left, right }));
}

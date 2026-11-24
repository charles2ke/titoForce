import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  API_NAME_RE,
  EXPRESSION_FUNCTIONS,
  FIELD_TYPES,
  type FieldDef,
  type FieldType,
  type FilterGroup,
  type FormulaResultType,
  type ObjectDef,
  type PaletteColor,
  type RollupDef,
  type RollupFunction,
  toApiName,
  type ValidationRule,
} from '@titoforce/shared';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ExternalLink, Lock, Pencil, Plus, ShieldAlert, ShieldCheck, Trash, X } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { completeFilter, FilterEditor } from '../../components/FilterEditor.tsx';
import { ColorPicker, IconPicker, InlineToggle } from '../../components/pickers.tsx';
import { Badge, Button, EmptyState, ErrorBanner, FormField, IconButton, Loading, Modal, PageHeader, Tabs, Toggle } from '../../components/ui.tsx';
import { inSentence, t, tryT, tx } from '../../i18n/index.ts';
import { fieldDef } from '../../lib/format.ts';
import { invalidateMetadata, useSetupObjectDef, useSetupObjects } from '../../lib/hooks.ts';
import { PageLayoutsTab } from './PageLayouts.tsx';

/** Display name of a field type. */
const typeLabel = (type: FieldType) => t(`setupObjects.fieldTypes.${type}`);

const FORMULA_TYPES: FormulaResultType[] = ['number', 'currency', 'percent', 'text', 'date', 'checkbox'];

const ROLLUP_FNS: RollupFunction[] = ['count', 'sum', 'avg', 'min', 'max'];

const NUMERIC_TYPES = new Set<string>(['number', 'currency', 'percent']);
const RESERVED = new Set(['id', 'owner_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'fields', 'object', 'data', 'refs']);
const LAYOUT_SYSTEM = ['name', 'owner_id', 'created_at', 'updated_at', 'created_by', 'updated_by'];
const FORMULA_SYSTEM = ['name', 'owner_id', 'created_at', 'updated_at'];

const isNumericField = (f: FieldDef) => NUMERIC_TYPES.has(f.type) || f.type === 'rollup' || (f.type === 'formula' && NUMERIC_TYPES.has(f.formulaType ?? ''));
const hasPrecision = (type: FieldType, formulaType: FormulaResultType) => NUMERIC_TYPES.has(type) || type === 'rollup' || (type === 'formula' && NUMERIC_TYPES.has(formulaType));
const supportsDefault = (type: FieldType) => !['formula', 'rollup', 'lookup', 'multipicklist'].includes(type);
const isDateField = (f: FieldDef) => f.type === 'date' || f.type === 'datetime';
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Replaces an object in the cached object list with the server's latest version. */
function cacheObject(qc: QueryClient, def: ObjectDef) {
  qc.setQueryData<ObjectDef[]>(['objects', 'raw'], (old) => old?.map((o) => (o.apiName === def.apiName ? def : o)));
}

function typeSummary(f: FieldDef, objects: ObjectDef[]): string {
  switch (f.type) {
    case 'lookup':
      return t('setupObjects.typeSummary.lookup', { object: f.referenceTo === '*' ? t('setupObjects.typeSummary.anyObject') : (objects.find((o) => o.apiName === f.referenceTo)?.label ?? f.referenceTo ?? '?') });
    case 'formula': {
      const resultType = FORMULA_TYPES.find((ft) => ft === f.formulaType);
      return t('setupObjects.typeSummary.formula', { type: resultType ? inSentence(typeLabel(resultType)) : String(f.formulaType) });
    }
    case 'rollup': {
      const fn = f.rollup?.fn;
      return t('setupObjects.typeSummary.rollup', { fn: fn ? (tryT(`setupObjects.typeSummary.rollupFns.${fn}`) ?? fn) : '?' });
    }
    case 'picklist':
    case 'multipicklist':
      return `${typeLabel(f.type)} · ${f.options?.length ?? 0}`;
    default:
      return tryT(`setupObjects.fieldTypes.${f.type}`) ?? f.type;
  }
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function MoveButtons({ index, count, label, onMove }: { index: number; count: number; label: string; onMove: (from: number, to: number) => void }) {
  return (
    <>
      <IconButton icon={ArrowUp} label={t('setupObjects.orderedList.moveUp', { label })} className="size-7 disabled:opacity-30" disabled={index === 0} onClick={() => onMove(index, index - 1)} />
      <IconButton icon={ArrowDown} label={t('setupObjects.orderedList.moveDown', { label })} className="size-7 disabled:opacity-30" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} />
    </>
  );
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Ordered multi-select: the chosen items in order (reorderable) plus a select to add more. */
function OrderedFieldList({ id, options, value, onChange, max }: { id: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; max: number }) {
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const available = options.filter((o) => !value.includes(o.value));
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {value.map((v, i) => (
            <li key={v} className="flex items-center gap-2 py-1 pr-1 pl-3 text-sm">
              <span className="w-4 text-xs text-slate-400 tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-slate-800">{labelOf(v)}</span>
              <MoveButtons index={i} count={value.length} label={labelOf(v)} onMove={(a, b) => onChange(moveItem(value, a, b))} />
              <IconButton icon={X} label={t('setupObjects.orderedList.remove', { label: labelOf(v) })} className="size-7" onClick={() => onChange(value.filter((x) => x !== v))} />
            </li>
          ))}
        </ol>
      )}
      <select id={id} className="input" value="" disabled={value.length >= max || !available.length} onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">{value.length >= max ? t('setupObjects.orderedList.maxReached', { max }) : available.length ? t('setupObjects.orderedList.addField') : t('setupObjects.orderedList.noMoreFields')}</option>
        {available.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormulaHelp({ examples }: { examples: string[] }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">{t('setupObjects.formulaHelp.title')}</summary>
      <div className="mt-2 space-y-1.5">
        <p>
          {tx('setupObjects.formulaHelp.fields', {
            example: <code>amount</code>,
            name: <code>name</code>,
            ownerId: <code>owner_id</code>,
            createdAt: <code>created_at</code>,
            updatedAt: <code>updated_at</code>,
          })}
        </p>
        <p>
          {tx('setupObjects.formulaHelp.operators', {
            arithmetic: <code>+ - * / %</code>,
            concat: <code>&amp;</code>,
            comparison: <code>== != &lt; &lt;= &gt; &gt;=</code>,
            logical: <code>&amp;&amp; || !</code>,
            conditional: <code>condition ? a : b</code>,
          })}
        </p>
        <p>{tx('setupObjects.formulaHelp.functions', { functions: <span className="font-mono">{EXPRESSION_FUNCTIONS.join(', ')}</span> })}</p>
        <p>{t('setupObjects.formulaHelp.examples')}</p>
        <ul className="list-disc space-y-0.5 pl-5 font-mono">
          {examples.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Fields tab
// ---------------------------------------------------------------------------

type OptionRow = { key: number; value: string; color?: PaletteColor };
type RollupState = { childObject: string; relationshipField: string; fn: RollupFunction; field: string; filter: FilterGroup | null };

const normRollup = (r: RollupState | RollupDef | undefined) =>
  r ? { childObject: r.childObject, relationshipField: r.relationshipField, fn: r.fn, ...(r.fn !== 'count' && r.field ? { field: r.field } : {}), filter: completeFilter(r.filter) } : undefined;

const defaultToString = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? String(v) : String(v));

function defaultPayload(type: FieldType, s: string): unknown {
  if (s.trim() === '') return null;
  if (type === 'checkbox') return s === 'true';
  if (NUMERIC_TYPES.has(type) && !s.includes('{{') && Number.isFinite(Number(s))) return Number(s);
  return s;
}

function OptionsEditor({ rows, onChange, isNew }: { rows: OptionRow[]; onChange: (rows: OptionRow[]) => void; isNew: boolean }) {
  const seq = useRef(rows.length);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="label">{t('setupObjects.fieldForm.options.values')}</span>
        {!isNew && <span className="text-xs text-slate-400">{t('setupObjects.fieldForm.options.renameHint')}</span>}
      </div>
      {rows.map((o, i) => (
        <div key={o.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 sm:flex-nowrap">
          <input
            aria-label={t('setupObjects.fieldForm.options.value', { n: i + 1 })}
            className="input min-w-40 flex-1"
            value={o.value}
            maxLength={100}
            placeholder={t('setupObjects.fieldForm.options.value', { n: i + 1 })}
            onChange={(e) => onChange(rows.map((r) => (r.key === o.key ? { ...r, value: e.target.value } : r)))}
          />
          <ColorPicker size="sm" label={t('setupObjects.fieldForm.options.color', { n: i + 1 })} value={o.color} onChange={(c) => onChange(rows.map((r) => (r.key === o.key ? { ...r, color: c } : r)))} />
          <div className="flex items-center">
            <MoveButtons index={i} count={rows.length} label={t('setupObjects.fieldForm.options.valueInSentence', { n: i + 1 })} onMove={(a, b) => onChange(moveItem(rows, a, b))} />
            <IconButton icon={X} label={t('setupObjects.fieldForm.options.remove', { n: i + 1 })} className="size-7" onClick={() => onChange(rows.filter((r) => r.key !== o.key))} />
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...rows, { key: seq.current++, value: '' }])}>
        {t('setupObjects.fieldForm.options.add')}
      </Button>
    </div>
  );
}

function FieldForm({ def, field, objects, onClose }: { def: ObjectDef; field: FieldDef | null; objects: ObjectDef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = !field;
  const formId = useId();
  const ids = {
    label: useId(),
    api: useId(),
    type: useId(),
    help: useId(),
    section: useId(),
    sections: useId(),
    def: useId(),
    ref: useId(),
    precision: useId(),
    formula: useId(),
    formulaType: useId(),
    insert: useId(),
    child: useId(),
    rel: useId(),
    fn: useId(),
    agg: useId(),
  };
  const formulaRef = useRef<HTMLTextAreaElement>(null);

  const [label, setLabel] = useState(field?.label ?? '');
  const [apiName, setApiName] = useState(field?.apiName ?? '');
  const [apiTouched, setApiTouched] = useState(false);
  const [type, setType] = useState<FieldType>(field?.type ?? 'text');
  const [required, setRequired] = useState(!!field?.required);
  const [helpText, setHelpText] = useState(field?.helpText ?? '');
  const [section, setSection] = useState(field?.section ?? '');
  const [sensitive, setSensitive] = useState(!!field?.sensitive);
  const [defaultValue, setDefaultValue] = useState(defaultToString(field?.defaultValue));
  const [options, setOptions] = useState<OptionRow[]>(() => (field?.options ?? []).map((o, i) => ({ key: i, value: o.value, color: o.color })));
  const [referenceTo, setReferenceTo] = useState(field?.referenceTo ?? '');
  const [cascadeDelete, setCascadeDelete] = useState(!!field?.cascadeDelete);
  const [precision, setPrecision] = useState(field?.precision === undefined ? '' : String(field.precision));
  const [formula, setFormula] = useState(field?.formula ?? '');
  const [formulaType, setFormulaType] = useState<FormulaResultType>(field?.formulaType ?? 'number');

  const childObjects = objects.filter((o) => o.fields.some((f) => f.type === 'lookup' && f.referenceTo === def.apiName));
  const relFieldsOf = (child: string) => objects.find((o) => o.apiName === child)?.fields.filter((f) => f.type === 'lookup' && f.referenceTo === def.apiName) ?? [];
  const numericFieldsOf = (child: string) => objects.find((o) => o.apiName === child)?.fields.filter(isNumericField) ?? [];
  const initialRollup = (): RollupState => {
    if (field?.rollup) return { childObject: field.rollup.childObject, relationshipField: field.rollup.relationshipField, fn: field.rollup.fn, field: field.rollup.field ?? '', filter: field.rollup.filter ?? null };
    const child = childObjects[0]?.apiName ?? '';
    return { childObject: child, relationshipField: relFieldsOf(child)[0]?.apiName ?? '', fn: 'count', field: numericFieldsOf(child)[0]?.apiName ?? '', filter: null };
  };
  const [rollup, setRollup] = useState<RollupState>(initialRollup);
  const childDef = objects.find((o) => o.apiName === rollup.childObject);

  const effectiveApi = isNew ? (apiTouched ? apiName : label.trim() ? toApiName(label) : '') : (field?.apiName ?? '');
  const apiError =
    !isNew || !effectiveApi
      ? null
      : !API_NAME_RE.test(effectiveApi)
        ? t('setupObjects.apiNameInvalid')
        : RESERVED.has(effectiveApi) || (effectiveApi === 'name' && (type !== 'text' || !!def.nameTemplate || def.nameField !== 'name'))
          ? t('setupObjects.fieldForm.reserved', { apiName: effectiveApi })
          : def.fields.some((f) => f.apiName === effectiveApi)
            ? t('setupObjects.fieldForm.alreadyExists')
            : null;

  const computed = type === 'formula' || type === 'rollup';
  const picklist = type === 'picklist' || type === 'multipicklist';

  const problem = (() => {
    if (!label.trim()) return t('setupObjects.fieldForm.problems.label');
    if (isNew && (!effectiveApi || apiError)) return t('setupObjects.fieldForm.problems.apiName');
    if (picklist) {
      if (!options.length) return t('setupObjects.fieldForm.problems.noOptions');
      if (options.some((o) => !o.value.trim())) return t('setupObjects.fieldForm.problems.emptyOption');
      const seen = new Set(options.map((o) => o.value.trim().toLowerCase()));
      if (seen.size !== options.length) return t('setupObjects.fieldForm.problems.duplicateOption');
    }
    if (type === 'lookup' && !referenceTo) return t('setupObjects.fieldForm.problems.lookupTarget');
    if (type === 'formula' && !formula.trim()) return t('setupObjects.fieldForm.problems.formula');
    if (type === 'rollup') {
      if (!rollup.childObject || !rollup.relationshipField) return t('setupObjects.fieldForm.problems.rollupSource');
      if (rollup.fn !== 'count' && !rollup.field) return t('setupObjects.fieldForm.problems.rollupField');
    }
    return null;
  })();

  const build = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { label: label.trim(), helpText: helpText.trim(), section: section.trim(), sensitive };
    if (!computed) body.required = required;
    if (supportsDefault(type)) body.defaultValue = defaultPayload(type, defaultValue);
    if (picklist) body.options = options.map((o) => (o.color ? { value: o.value.trim(), color: o.color } : { value: o.value.trim() }));
    if (type === 'lookup') {
      body.referenceTo = referenceTo;
      body.cascadeDelete = cascadeDelete;
    }
    if (hasPrecision(type, formulaType) && precision !== '') body.precision = Number(precision);
    if (type === 'formula') {
      body.formula = formula.trim();
      body.formulaType = formulaType;
    }
    if (type === 'rollup') body.rollup = normRollup(rollup);
    return body;
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = build();
      if (isNew) {
        const payload: Record<string, unknown> = { ...body, type, apiName: effectiveApi };
        for (const k of ['helpText', 'section'] as const) if (!payload[k]) delete payload[k];
        if (payload.defaultValue === null) delete payload.defaultValue;
        return api.post<ObjectDef>(`/api/objects/${def.apiName}/fields`, payload);
      }
      const f = field!;
      const original: Record<string, unknown> = {
        label: f.label,
        helpText: f.helpText ?? '',
        section: f.section ?? '',
        sensitive: !!f.sensitive,
        required: !!f.required,
        defaultValue: f.defaultValue ?? null,
        options: f.options?.map((o) => (o.color ? { value: o.value, color: o.color } : { value: o.value })),
        referenceTo: f.referenceTo,
        cascadeDelete: !!f.cascadeDelete,
        precision: f.precision,
        formula: f.formula,
        formulaType: f.formulaType,
        rollup: normRollup(f.rollup),
      };
      const patch = Object.fromEntries(Object.entries(body).filter(([k, v]) => !sameJson(v, original[k])));
      if (!Object.keys(patch).length) return null;
      return api.patch<ObjectDef>(`/api/objects/${def.apiName}/fields/${f.apiName}`, patch);
    },
    onSuccess: async (next) => {
      if (next) {
        cacheObject(qc, next);
        toast.success(isNew ? t('setupObjects.fieldForm.created', { label: label.trim() }) : t('setupObjects.fieldForm.saved', { label: label.trim() }));
      }
      onClose();
      await invalidateMetadata(qc);
    },
  });

  const sections = [...new Set(def.fields.map((f) => f.section).filter((s): s is string => !!s))];
  const formulaFields = [
    ...def.fields.filter((f) => f.apiName !== field?.apiName && f.apiName !== effectiveApi).map((f) => ({ value: f.apiName, label: f.label })),
    ...FORMULA_SYSTEM.filter((s) => !def.fields.some((f) => f.apiName === s)).map((s) => ({ value: s, label: fieldDef(def, s)?.label ?? s })),
  ];
  const insertIntoFormula = (token: string) => {
    const el = formulaRef.current;
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    const next = formula.slice(0, start) + token + formula.slice(end);
    setFormula(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const changeType = (t: FieldType) => {
    setType(t);
    if ((t === 'picklist' || t === 'multipicklist') && !options.length) setOptions([{ key: 1000, value: '' }]);
    setDefaultValue('');
  };

  let defaultInput: ReactNode = null;
  if (supportsDefault(type)) {
    if (type === 'checkbox') {
      defaultInput = (
        <select id={ids.def} className="input" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)}>
          <option value="">{t('setupObjects.fieldForm.noDefault')}</option>
          <option value="true">{t('setupObjects.fieldForm.checked')}</option>
          <option value="false">{t('setupObjects.fieldForm.unchecked')}</option>
        </select>
      );
    } else if (type === 'picklist') {
      const values = options.map((o) => o.value.trim()).filter(Boolean);
      defaultInput = (
        <select id={ids.def} className="input" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)}>
          <option value="">{t('setupObjects.fieldForm.noDefault')}</option>
          {defaultValue && !values.includes(defaultValue) && <option value={defaultValue}>{defaultValue}</option>}
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    } else {
      defaultInput = (
        <input
          id={ids.def}
          className="input"
          value={defaultValue}
          placeholder={type === 'date' ? '{{TODAY()}}' : type === 'user' ? '{{user.id}}' : NUMERIC_TYPES.has(type) ? '0' : ''}
          onChange={(e) => setDefaultValue(e.target.value)}
        />
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('setupObjects.fieldForm.newTitle', { object: def.label }) : t('setupObjects.editItem', { name: field?.label ?? '' })}
      size="lg"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            {isNew ? t('setupObjects.fieldForm.create') : t('setupObjects.fieldForm.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('setupObjects.fieldForm.fieldLabel')} required htmlFor={ids.label}>
            <input id={ids.label} className="input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
          </FormField>
          {isNew ? (
            <FormField label={t('common.apiName')} required htmlFor={ids.api} error={apiError} help={t('setupObjects.fieldForm.apiNameHelp')}>
              <input
                id={ids.api}
                className="input font-mono"
                value={effectiveApi}
                maxLength={40}
                onChange={(e) => {
                  setApiTouched(true);
                  setApiName(e.target.value);
                }}
              />
            </FormField>
          ) : (
            <FormField label={t('common.apiName')}>
              <div className="input bg-slate-50 font-mono text-slate-600">{field?.apiName}</div>
            </FormField>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {isNew ? (
            <FormField label={t('common.type')} required htmlFor={ids.type}>
              <select id={ids.type} className="input" value={type} onChange={(e) => changeType(e.target.value as FieldType)}>
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {typeLabel(ft)}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label={t('common.type')} help={t('setupObjects.fieldForm.typeHelp')}>
              <div className="input bg-slate-50 text-slate-600">{typeSummary(field!, objects)}</div>
            </FormField>
          )}
          <FormField label={t('setupObjects.section')} htmlFor={ids.section} help={t('setupObjects.fieldForm.sectionHelp')}>
            <input id={ids.section} className="input" list={ids.sections} value={section} maxLength={60} placeholder={t('common.details')} onChange={(e) => setSection(e.target.value)} />
            <datalist id={ids.sections}>
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </FormField>
        </div>

        {picklist && <OptionsEditor rows={options} onChange={setOptions} isNew={isNew} />}

        {type === 'lookup' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('setupObjects.fieldForm.lookup.relatedObject')} required htmlFor={ids.ref} help={isNew ? t('setupObjects.fieldForm.lookup.newHelp') : t('setupObjects.fieldForm.lookup.editHelp')}>
              <select id={ids.ref} className="input" value={referenceTo} disabled={!isNew} onChange={(e) => setReferenceTo(e.target.value)}>
                <option value="">{t('setupObjects.fieldForm.lookup.chooseObject')}</option>
                <option value="*">{t('setupObjects.fieldForm.lookup.anyObject')}</option>
                {[...objects]
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((o) => (
                    <option key={o.apiName} value={o.apiName}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </FormField>
            <div className="pt-6">
              <Toggle checked={cascadeDelete} onChange={setCascadeDelete} label={t('setupObjects.fieldForm.lookup.cascadeDelete')} />
              <p className="mt-1 text-xs text-slate-400">{t('setupObjects.fieldForm.lookup.cascadeHelp')}</p>
            </div>
          </div>
        )}

        {type === 'formula' && (
          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('setupObjects.fieldForm.formula.resultType')} required htmlFor={ids.formulaType}>
                <select id={ids.formulaType} className="input" value={formulaType} onChange={(e) => setFormulaType(e.target.value as FormulaResultType)}>
                  {FORMULA_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {typeLabel(ft)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label={t('setupObjects.fieldForm.formula.insertField')} htmlFor={ids.insert}>
                <select id={ids.insert} className="input" value="" onChange={(e) => e.target.value && insertIntoFormula(e.target.value)}>
                  <option value="">{t('setupObjects.fieldForm.formula.chooseField')}</option>
                  {formulaFields.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label} ({f.value})
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label={t('setupObjects.fieldForm.formula.formula')} required htmlFor={ids.formula} help={t('setupObjects.fieldForm.formula.help')}>
              <textarea ref={formulaRef} id={ids.formula} className="input font-mono text-xs" rows={4} spellCheck={false} value={formula} maxLength={4000} placeholder="amount * probability / 100" onChange={(e) => setFormula(e.target.value)} />
            </FormField>
            <FormulaHelp examples={['amount * probability / 100', "IF(priority == 'Urgent', 4, 24)", "CASE(stage, 'Closed Won', 100, 'Closed Lost', 0, 50)", 'DAYS_BETWEEN(created_at, TODAY())', "first_name & ' ' & last_name"]} />
          </div>
        )}

        {type === 'rollup' && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            {childObjects.length === 0 ? (
              <p className="text-sm text-slate-500">{t('setupObjects.fieldForm.rollup.noChildren', { object: def.label })}</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t('setupObjects.fieldForm.rollup.childObject')} required htmlFor={ids.child}>
                    <select
                      id={ids.child}
                      className="input"
                      value={rollup.childObject}
                      onChange={(e) => {
                        const child = e.target.value;
                        setRollup({ ...rollup, childObject: child, relationshipField: relFieldsOf(child)[0]?.apiName ?? '', field: numericFieldsOf(child)[0]?.apiName ?? '', filter: null });
                      }}
                    >
                      {!childDef && <option value={rollup.childObject}>{rollup.childObject || t('common.choose')}</option>}
                      {childObjects.map((o) => (
                        <option key={o.apiName} value={o.apiName}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label={t('setupObjects.fieldForm.rollup.relationshipField')} required htmlFor={ids.rel} help={t('setupObjects.fieldForm.rollup.relationshipHelp', { object: def.label })}>
                    <select id={ids.rel} className="input" value={rollup.relationshipField} onChange={(e) => setRollup({ ...rollup, relationshipField: e.target.value })}>
                      {!relFieldsOf(rollup.childObject).some((f) => f.apiName === rollup.relationshipField) && <option value={rollup.relationshipField}>{rollup.relationshipField || t('common.choose')}</option>}
                      {relFieldsOf(rollup.childObject).map((f) => (
                        <option key={f.apiName} value={f.apiName}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label={t('setupObjects.fieldForm.rollup.fn')} required htmlFor={ids.fn}>
                    <select id={ids.fn} className="input" value={rollup.fn} onChange={(e) => setRollup({ ...rollup, fn: e.target.value as RollupFunction })}>
                      {ROLLUP_FNS.map((fn) => (
                        <option key={fn} value={fn}>
                          {t(`setupObjects.rollupFns.${fn}`)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  {rollup.fn !== 'count' && (
                    <FormField label={t('setupObjects.fieldForm.rollup.field')} required htmlFor={ids.agg}>
                      <select id={ids.agg} className="input" value={rollup.field} onChange={(e) => setRollup({ ...rollup, field: e.target.value })}>
                        {!numericFieldsOf(rollup.childObject).some((f) => f.apiName === rollup.field) && <option value={rollup.field}>{rollup.field || t('setupObjects.fieldForm.rollup.chooseNumeric')}</option>}
                        {numericFieldsOf(rollup.childObject).map((f) => (
                          <option key={f.apiName} value={f.apiName}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  )}
                </div>
                {childDef && (
                  <div>
                    <span className="label">{t('setupObjects.fieldForm.rollup.filter')}</span>
                    <FilterEditor def={childDef} value={rollup.filter} onChange={(filter) => setRollup({ ...rollup, filter })} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {hasPrecision(type, formulaType) && (
          <FormField label={t('setupObjects.fieldForm.precision')} htmlFor={ids.precision} help={type === 'currency' ? t('setupObjects.fieldForm.precisionCurrencyHelp') : t('setupObjects.fieldForm.precisionHelp')}>
            <input id={ids.precision} type="number" min={0} max={8} step={1} className="input sm:w-40" value={precision} onChange={(e) => setPrecision(e.target.value)} />
          </FormField>
        )}

        {supportsDefault(type) && (
          <FormField label={t('setupObjects.fieldForm.defaultValue')} htmlFor={ids.def} help={t('setupObjects.fieldForm.defaultValueHelp', { today: '{{TODAY()}}', addDays: '{{ADD_DAYS(TODAY(), 7)}}', userId: '{{user.id}}' })}>
            {defaultInput}
          </FormField>
        )}

        <FormField label={t('setupObjects.fieldForm.helpText')} htmlFor={ids.help} help={t('setupObjects.fieldForm.helpTextHelp')}>
          <input id={ids.help} className="input" value={helpText} maxLength={500} onChange={(e) => setHelpText(e.target.value)} />
        </FormField>

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {!computed && <Toggle checked={required} onChange={setRequired} label={t('common.required')} />}
          <Toggle checked={sensitive} onChange={setSensitive} label={t('setupObjects.sensitive')} />
        </div>
        {sensitive && (
          <p className="-mt-2 flex items-center gap-1.5 text-xs text-amber-700">
            <ShieldAlert className="size-3.5" aria-hidden /> {t('setupObjects.fieldForm.sensitiveHint', { capability: t('setupRoles.capabilities.viewSensitive.label') })}
          </p>
        )}
      </form>
    </Modal>
  );
}

function FieldsTab({ def, objects }: { def: ObjectDef; objects: ObjectDef[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<FieldDef | 'new' | null>(null);
  const del = useMutation({
    mutationFn: (f: FieldDef) => api.del<ObjectDef>(`/api/objects/${def.apiName}/fields/${f.apiName}`),
    onSuccess: async (next, f) => {
      cacheObject(qc, next);
      toast.success(t('setupObjects.fields.deleted', { label: f.label }));
      await invalidateMetadata(qc);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const deletable = (f: FieldDef) => !!f.isCustom && !(def.nameField === f.apiName && !def.nameTemplate);

  const onDelete = async (f: FieldDef) => {
    const ok = await confirm({
      title: t('setupObjects.fields.deleteTitle', { label: f.label }),
      message: t('setupObjects.fields.deleteMessage', { object: inSentence(def.label) }),
      confirmLabel: t('setupObjects.fields.deleteConfirm'),
      danger: true,
    });
    if (ok) del.mutate(f);
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">{t('setupObjects.fields.count', { count: def.fields.length })}</p>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing('new')}>
          {t('setupObjects.fields.newField')}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2.5">{t('common.label')}</th>
              <th className="px-4 py-2.5">{t('common.apiName')}</th>
              <th className="px-4 py-2.5">{t('common.type')}</th>
              <th className="px-4 py-2.5 text-center">{t('common.required')}</th>
              <th className="px-4 py-2.5 text-center">{t('setupObjects.sensitive')}</th>
              <th className="px-4 py-2.5">{t('setupObjects.section')}</th>
              <th className="px-4 py-2.5">{t('setupObjects.fields.origin')}</th>
              <th className="px-4 py-2.5">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {def.fields.map((f) => (
              <tr key={f.apiName} className="hover:bg-slate-50/70">
                <td className="px-4 py-2.5 font-medium text-slate-900">
                  {f.label}
                  {def.nameField === f.apiName && !def.nameTemplate && (
                    <Badge color="indigo" className="ml-2">
                      {t('setupObjects.recordName')}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{f.apiName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">{typeSummary(f, objects)}</td>
                <td className="px-4 py-2.5 text-center">{f.required ? <Check className="mx-auto size-4 text-emerald-600" aria-label={t('common.required')} /> : <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2.5 text-center">{f.sensitive ? <Lock className="mx-auto size-4 text-amber-600" aria-label={t('setupObjects.sensitive')} /> : <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2.5 text-slate-600">{f.section ?? ''}</td>
                <td className="px-4 py-2.5">{f.isCustom ? <Badge color="purple">{t('setupObjects.custom')}</Badge> : <Badge color="gray">{t('setupObjects.standard')}</Badge>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <IconButton icon={Pencil} label={t('setupObjects.editItem', { name: f.label })} onClick={() => setEditing(f)} />
                    {deletable(f) ? (
                      <IconButton icon={Trash} label={t('setupObjects.deleteItem', { name: f.label })} className="hover:text-rose-600" disabled={del.isPending} onClick={() => void onDelete(f)} />
                    ) : (
                      <span className="inline-flex size-8 items-center justify-center text-slate-300" title={f.isCustom ? t('setupObjects.fields.nameFieldLocked') : t('setupObjects.fields.standardLocked')}>
                        <Lock className="size-3.5" aria-hidden />
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <FieldForm key={editing === 'new' ? '__new' : editing.apiName} def={def} field={editing === 'new' ? null : editing} objects={objects} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details & behavior tab
// ---------------------------------------------------------------------------

function LayoutTab({ def }: { def: ObjectDef }) {
  const qc = useQueryClient();
  const toast = useToast();
  const ids = {
    label: useId(),
    plural: useId(),
    desc: useId(),
    icon: useId(),
    nameField: useId(),
    nameTemplate: useId(),
    status: useId(),
    date: useId(),
    tlStart: useId(),
    tlEnd: useId(),
    highlight: useId(),
    list: useId(),
    dup: useId(),
  };
  const [label, setLabel] = useState(def.label);
  const [plural, setPlural] = useState(def.pluralLabel);
  const [description, setDescription] = useState(def.description ?? '');
  const [icon, setIcon] = useState(def.icon);
  const [color, setColor] = useState(def.color);
  const [nameMode, setNameMode] = useState<'field' | 'template'>(def.nameTemplate ? 'template' : 'field');
  const [nameField, setNameField] = useState(def.nameField);
  const [nameTemplate, setNameTemplate] = useState(def.nameTemplate ?? '');
  const [statusField, setStatusField] = useState(def.statusField ?? '');
  const [dateField, setDateField] = useState(def.dateField ?? '');
  const [tlStart, setTlStart] = useState(def.timeline?.start ?? '');
  const [tlEnd, setTlEnd] = useState(def.timeline?.end ?? '');
  const [highlight, setHighlight] = useState(def.highlightFields ?? []);
  const [listFields, setListFields] = useState(def.listFields ?? []);
  const [dupFields, setDupFields] = useState(def.duplicateFields ?? []);

  const textFields = def.fields.filter((f) => f.type === 'text' || f.apiName === def.nameField);
  const picklists = def.fields.filter((f) => f.type === 'picklist');
  const dateFields = [...def.fields.filter(isDateField), { apiName: 'created_at', label: t('common.created') }];
  const layoutOptions = [
    ...def.fields.map((f) => ({ value: f.apiName, label: f.label })),
    ...LAYOUT_SYSTEM.filter((s) => !def.fields.some((f) => f.apiName === s)).map((s) => ({ value: s, label: fieldDef(def, s)?.label ?? s })),
  ];
  const dupOptions = def.fields.filter((f) => ['text', 'email', 'phone', 'url'].includes(f.type)).map((f) => ({ value: f.apiName, label: f.label }));

  const timeline = tlStart && tlEnd ? { start: tlStart, end: tlEnd } : null;
  const patch: Record<string, unknown> = {};
  if (label.trim() !== def.label) patch.label = label.trim();
  if (plural.trim() !== def.pluralLabel) patch.pluralLabel = plural.trim();
  if (description !== (def.description ?? '')) patch.description = description;
  if (icon !== def.icon) patch.icon = icon;
  if (color !== def.color) patch.color = color;
  if (nameMode === 'template') {
    if (nameTemplate.trim() !== (def.nameTemplate ?? '')) patch.nameTemplate = nameTemplate.trim();
  } else {
    if (def.nameTemplate) patch.nameTemplate = null;
    if (nameField !== def.nameField) patch.nameField = nameField;
  }
  if (statusField !== (def.statusField ?? '')) patch.statusField = statusField || null;
  if (dateField !== (def.dateField ?? '')) patch.dateField = dateField || null;
  if (!sameJson(timeline, def.timeline ? { start: def.timeline.start, end: def.timeline.end } : null)) patch.timeline = timeline;
  if (!sameJson(highlight, def.highlightFields ?? [])) patch.highlightFields = highlight;
  if (!sameJson(listFields, def.listFields ?? [])) patch.listFields = listFields;
  if (!sameJson(dupFields, def.duplicateFields ?? [])) patch.duplicateFields = dupFields;
  const dirty = Object.keys(patch).length > 0;

  const problem = !label.trim() || !plural.trim() ? t('setupObjects.layout.problems.labels') : nameMode === 'template' && !nameTemplate.trim() ? t('setupObjects.layout.problems.nameTemplate') : !!tlStart !== !!tlEnd ? t('setupObjects.layout.problems.timeline') : null;

  const save = useMutation({
    mutationFn: () => api.patch<ObjectDef>(`/api/objects/${def.apiName}`, patch),
    onSuccess: async (next) => {
      cacheObject(qc, next);
      toast.success(t('setupObjects.layout.saved'));
      await invalidateMetadata(qc);
    },
  });

  const select = (id: string, value: string, onChange: (v: string) => void, options: { apiName: string; label: string }[], empty: string) => (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {value && !options.some((o) => o.apiName === value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.apiName} value={o.apiName}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !problem) save.mutate();
      }}
    >
      <ErrorBanner error={save.error} />
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('common.details')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('common.label')} required htmlFor={ids.label}>
            <input id={ids.label} className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
          </FormField>
          <FormField label={t('setupObjects.pluralLabel')} required htmlFor={ids.plural}>
            <input id={ids.plural} className="input" value={plural} maxLength={60} onChange={(e) => setPlural(e.target.value)} />
          </FormField>
          <FormField label={t('common.description')} htmlFor={ids.desc} className="sm:col-span-2">
            <textarea id={ids.desc} className="input" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label={t('common.icon')} htmlFor={ids.icon}>
            <IconPicker id={ids.icon} value={icon} onChange={setIcon} />
          </FormField>
          <div>
            <span className="label">{t('common.color')}</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">{t('setupObjects.recordName')}</h2>
        <p className="mb-3 text-xs text-slate-500">{t('setupObjects.layout.recordNameHelp')}</p>
        <div role="radiogroup" aria-label={t('setupObjects.layout.recordNameSource')} className="mb-3 flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="nameMode" className="accent-indigo-600" checked={nameMode === 'field'} onChange={() => setNameMode('field')} /> {t('setupObjects.layout.useField')}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="nameMode" className="accent-indigo-600" checked={nameMode === 'template'} onChange={() => setNameMode('template')} /> {t('setupObjects.layout.useTemplate')}
          </label>
        </div>
        {nameMode === 'field' ? (
          <FormField label={t('setupObjects.layout.nameField')} required htmlFor={ids.nameField} className="sm:w-1/2">
            <select id={ids.nameField} className="input" value={nameField} onChange={(e) => setNameField(e.target.value)}>
              {!textFields.some((f) => f.apiName === nameField) && <option value={nameField}>{nameField}</option>}
              {textFields.map((f) => (
                <option key={f.apiName} value={f.apiName}>
                  {f.label}
                </option>
              ))}
            </select>
          </FormField>
        ) : (
          <FormField label={t('setupObjects.layout.nameTemplate')} required htmlFor={ids.nameTemplate} help={t('setupObjects.layout.nameTemplateHelp', { placeholder: '{field_api_name}', example: '{first_name} {last_name}' })}>
            <input id={ids.nameTemplate} className="input font-mono" value={nameTemplate} maxLength={200} placeholder="{first_name} {last_name}" onChange={(e) => setNameTemplate(e.target.value)} />
          </FormField>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('setupObjects.layout.views')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('setupObjects.layout.statusField')} htmlFor={ids.status} help={t('setupObjects.layout.statusFieldHelp')}>
            {select(ids.status, statusField, setStatusField, picklists, t('common.none'))}
          </FormField>
          <FormField label={t('setupObjects.layout.dateField')} htmlFor={ids.date} help={t('setupObjects.layout.dateFieldHelp')}>
            {select(ids.date, dateField, setDateField, dateFields, t('common.none'))}
          </FormField>
          <FormField label={t('setupObjects.layout.timelineStart')} htmlFor={ids.tlStart} help={t('setupObjects.layout.timelineStartHelp')}>
            {select(ids.tlStart, tlStart, setTlStart, dateFields, t('common.none'))}
          </FormField>
          <FormField label={t('setupObjects.layout.timelineEnd')} htmlFor={ids.tlEnd}>
            {select(ids.tlEnd, tlEnd, setTlEnd, dateFields, t('common.none'))}
          </FormField>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('setupObjects.layout.layout')}</h2>
        <div className="grid gap-5 @3xl:grid-cols-3">
          <FormField label={t('setupObjects.layout.highlightFields', { count: highlight.length, max: 8 })} htmlFor={ids.highlight} help={t('setupObjects.layout.highlightFieldsHelp')}>
            <OrderedFieldList id={ids.highlight} options={layoutOptions} value={highlight} onChange={setHighlight} max={8} />
          </FormField>
          <FormField label={t('setupObjects.layout.listColumns', { count: listFields.length, max: 15 })} htmlFor={ids.list} help={t('setupObjects.layout.listColumnsHelp')}>
            <OrderedFieldList id={ids.list} options={layoutOptions} value={listFields} onChange={setListFields} max={15} />
          </FormField>
          <FormField label={t('setupObjects.layout.duplicateCheck', { count: dupFields.length, max: 5 })} htmlFor={ids.dup} help={t('setupObjects.layout.duplicateCheckHelp')}>
            <OrderedFieldList id={ids.dup} options={dupOptions} value={dupFields} onChange={setDupFields} max={5} />
          </FormField>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/90 px-1 py-3 backdrop-blur">
        {problem ? <span className="mr-auto text-xs text-rose-600">{problem}</span> : dirty ? <span className="mr-auto text-xs text-slate-500">{t('setupObjects.unsavedChanges')}</span> : null}
        <Button variant="primary" type="submit" icon={Check} disabled={!dirty || !!problem} loading={save.isPending}>
          {t('common.saveChanges')}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Validation rules tab
// ---------------------------------------------------------------------------

function RuleForm({ def, index, onClose }: { def: ObjectDef; index: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const formId = useId();
  const ids = { name: useId(), condition: useId(), message: useId() };
  const rules = def.validationRules ?? [];
  const current = index === null ? undefined : rules[index];
  const [name, setName] = useState(current?.name ?? '');
  const [condition, setCondition] = useState(current?.condition ?? '');
  const [message, setMessage] = useState(current?.message ?? '');
  const [active, setActive] = useState(current?.active !== false);

  const save = useMutation({
    mutationFn: () => {
      const rule: ValidationRule = { name: name.trim(), condition: condition.trim(), message: message.trim(), active };
      const next = index === null ? [...rules, rule] : rules.map((r, i) => (i === index ? rule : r));
      return api.patch<ObjectDef>(`/api/objects/${def.apiName}`, { validationRules: next });
    },
    onSuccess: async (next) => {
      cacheObject(qc, next);
      toast.success(index === null ? t('setupObjects.ruleForm.created') : t('setupObjects.ruleForm.saved'));
      onClose();
      await invalidateMetadata(qc);
    },
  });
  const canSave = !!name.trim() && !!condition.trim() && !!message.trim();
  const firstField = def.fields.find((f) => f.type === 'number' || f.type === 'currency')?.apiName ?? 'amount';
  const firstDate = def.fields.find(isDateField)?.apiName ?? 'close_date';

  return (
    <Modal
      open
      onClose={onClose}
      title={index === null ? t('setupObjects.ruleForm.newTitle') : t('setupObjects.ruleForm.editTitle', { name: current?.name ?? '' })}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSave} loading={save.isPending}>
            {t('setupObjects.ruleForm.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />
        <FormField label={t('setupObjects.ruleForm.name')} required htmlFor={ids.name}>
          <input id={ids.name} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label={t('setupObjects.rules.errorCondition')} required htmlFor={ids.condition} help={t('setupObjects.ruleForm.conditionHelp')}>
          <textarea id={ids.condition} className="input font-mono text-xs" rows={3} spellCheck={false} maxLength={2000} value={condition} placeholder={`${firstField} < 0`} onChange={(e) => setCondition(e.target.value)} />
        </FormField>
        <FormulaHelp examples={[`${firstField} < 0`, `ISBLANK(${firstDate})`, `${firstDate} < TODAY()`, `LEN(name) < 3`]} />
        <FormField label={t('setupObjects.ruleForm.errorMessage')} required htmlFor={ids.message}>
          <input id={ids.message} className="input" value={message} maxLength={255} onChange={(e) => setMessage(e.target.value)} />
        </FormField>
        <Toggle checked={active} onChange={setActive} label={t('common.active')} />
      </form>
    </Modal>
  );
}

function RulesTab({ def }: { def: ObjectDef }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const rules = def.validationRules ?? [];
  const update = useMutation({
    mutationFn: (next: ValidationRule[]) => api.patch<ObjectDef>(`/api/objects/${def.apiName}`, { validationRules: next }),
    onSuccess: async (next) => {
      cacheObject(qc, next);
      await invalidateMetadata(qc);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">{t('setupObjects.rules.intro', { object: inSentence(def.label), max: 30 })}</p>
        <Button variant="primary" size="sm" icon={Plus} disabled={rules.length >= 30} onClick={() => setEditing('new')}>
          {t('setupObjects.rules.newRule')}
        </Button>
      </div>
      {rules.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t('setupObjects.rules.empty')}>
          {t('setupObjects.rules.emptyHelp')}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">{t('common.name')}</th>
                <th className="px-4 py-2.5">{t('setupObjects.rules.errorCondition')}</th>
                <th className="px-4 py-2.5">{t('setupObjects.rules.message')}</th>
                <th className="px-4 py-2.5">{t('common.active')}</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((r, i) => (
                <tr key={`${i}-${r.name}`} className="align-top hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td>
                  <td className="max-w-xs px-4 py-2.5">
                    <code className="block truncate font-mono text-xs text-slate-700" title={r.condition}>
                      {r.condition}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{r.message}</td>
                  <td className="px-4 py-2.5">
                    <InlineToggle
                      checked={r.active !== false}
                      disabled={update.isPending}
                      label={t('setupObjects.rules.activeLabel', { name: r.name })}
                      onChange={(v) => update.mutate(rules.map((x, j) => (j === i ? { ...x, active: v } : x)), { onSuccess: () => toast.success(v ? t('setupObjects.rules.activated', { name: r.name }) : t('setupObjects.rules.deactivated', { name: r.name })) })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <IconButton icon={Pencil} label={t('setupObjects.editItem', { name: r.name })} onClick={() => setEditing(i)} />
                      <IconButton
                        icon={Trash}
                        label={t('setupObjects.deleteItem', { name: r.name })}
                        className="hover:text-rose-600"
                        disabled={update.isPending}
                        onClick={async () => {
                          const ok = await confirm({ title: t('setupObjects.rules.deleteTitle', { name: r.name }), message: t('setupObjects.rules.deleteMessage'), confirmLabel: t('setupObjects.rules.deleteConfirm'), danger: true });
                          if (ok) update.mutate(rules.filter((_, j) => j !== i), { onSuccess: () => toast.success(t('setupObjects.rules.deleted')) });
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null && <RuleForm key={String(editing)} def={def} index={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TAB_IDS = ['fields', 'layout', 'pageLayouts', 'rules'] as const;
type TabId = (typeof TAB_IDS)[number];

export default function ObjectDetail() {
  const { api: apiName } = useParams();
  const { def, isLoading, error } = useSetupObjectDef(apiName);
  const objects = useSetupObjects();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => TAB_IDS.find((id) => id === params.get('tab')) ?? 'fields');
  // Stays mounted once opened so a layout draft survives switching tabs.
  const [layoutsOpened, setLayoutsOpened] = useState(tab === 'pageLayouts');

  const remove = useMutation({
    mutationFn: (name: string) => api.del(`/api/objects/${name}`),
    onSuccess: async (_r, name) => {
      navigate('/setup/objects');
      for (const key of [['objects'], ['objects', 'raw']]) qc.setQueryData<ObjectDef[]>(key, (old) => old?.filter((o) => o.apiName !== name));
      toast.success(t('setupObjects.detail.deleted'));
      await Promise.all([invalidateMetadata(qc), qc.invalidateQueries({ queryKey: ['automations'] })]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Loading />;
  if (error)
    return (
      <div className="p-6">
        <ErrorBanner error={error} />
      </div>
    );
  if (!def)
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="card">
          <EmptyState
            title={t('setupObjects.detail.notFound')}
            action={
              <Link to="/setup/objects" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                {t('setupObjects.detail.backToObjects')}
              </Link>
            }
          >
            {t('setupObjects.detail.notFoundHelp')}
          </EmptyState>
        </div>
      </div>
    );

  const onDelete = async () => {
    const ok = await confirm({
      title: t('setupObjects.detail.deleteTitle', { label: def.label }),
      message: t('setupObjects.detail.deleteMessage', { object: def.label }),
      confirmLabel: t('setupObjects.detail.deleteObject'),
      danger: true,
    });
    if (ok) remove.mutate(def.apiName);
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link to="/setup/objects" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="size-4" aria-hidden /> {t('setupObjects.detail.back')}
      </Link>
      <PageHeader
        icon={def.icon}
        color={def.color}
        title={def.label}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{def.apiName}</span>
            {def.isCustom ? <Badge color="purple">{t('setupObjects.custom')}</Badge> : <Badge color="gray">{t('setupObjects.standard')}</Badge>}
          </span>
        }
        actions={
          <>
            <Link to={`/o/${def.apiName}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50">
              <ExternalLink className="size-4" aria-hidden /> {t('setupObjects.detail.viewRecords')}
            </Link>
            {def.isCustom && (
              <Button variant="danger" icon={Trash} loading={remove.isPending} onClick={() => void onDelete()}>
                {t('setupObjects.detail.deleteObject')}
              </Button>
            )}
          </>
        }
      >
        {def.description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{def.description}</p>}
      </PageHeader>
      <Tabs<TabId>
        tabs={[
          { id: 'fields', label: t('setupObjects.detail.tabs.fields', { count: def.fields.length }) },
          { id: 'layout', label: t('setupObjects.detail.tabs.layout') },
          { id: 'pageLayouts', label: t('setupObjects.detail.tabs.pageLayouts') },
          { id: 'rules', label: t('setupObjects.detail.tabs.rules', { count: def.validationRules?.length ?? 0 }) },
        ]}
        value={tab}
        onChange={(next) => {
          if (next === 'pageLayouts') setLayoutsOpened(true);
          setTab(next);
        }}
      />
      <div className="mt-4">
        {tab === 'fields' && <FieldsTab def={def} objects={objects.data ?? []} />}
        {tab === 'layout' && <LayoutTab key={def.updatedAt ?? ''} def={def} />}
        {tab === 'rules' && <RulesTab def={def} />}
        {layoutsOpened && (
          <div hidden={tab !== 'pageLayouts'}>
            <PageLayoutsTab key={def.apiName} def={def} />
          </div>
        )}
      </div>
    </div>
  );
}

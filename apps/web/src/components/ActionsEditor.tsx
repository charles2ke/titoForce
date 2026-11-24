import { useQuery } from '@tanstack/react-query';
import type { ApprovalProcessDef, AutomationAction, AutomationActionType, FieldDef, ObjectDef, RecordResponse, RoleDef } from '@titoforce/shared';
import { ArrowDown, ArrowUp, Braces, Plus, Trash, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { api, qs } from '../api.ts';
import { t, tx } from '../i18n/index.ts';
import { isEditable } from '../lib/format.ts';
import { useAgents, useObjects, usePermissions } from '../lib/hooks.ts';
import { FieldInput, UserSelect } from './FieldInput.tsx';
import { Button, cx, FormField, IconButton, MenuItem, Popover } from './ui.tsx';

/** Labels are getters so they are translated when read (in the active language). */
export const ACTION_LABELS: Record<AutomationActionType, string> = {
  get update_record() {
    return t('setupAutomations.actionTypes.updateRecord');
  },
  get update_related() {
    return t('setupAutomations.actionTypes.updateRelated');
  },
  get create_record() {
    return t('setupAutomations.actionTypes.createRecord');
  },
  get notify() {
    return t('setupAutomations.actionTypes.notify');
  },
  get run_agent() {
    return t('setupAutomations.actionTypes.runAgent');
  },
  get webhook() {
    return t('setupAutomations.actionTypes.webhook');
  },
  get submit_approval() {
    return t('setupAutomations.actionTypes.submitApproval');
  },
};

const ALL_TYPES = Object.keys(ACTION_LABELS) as AutomationActionType[];

const OWNER_FIELD: FieldDef = {
  apiName: 'owner_id',
  get label() {
    return t('common.owner');
  },
  type: 'user',
};
const TEXTUAL = new Set(['text', 'longtext', 'email', 'phone', 'url']);

const RECIPIENT_RE = /^(owner|triggering_user|user:[a-z0-9_]+|role:[a-z0-9_]+|field:[a-z][a-z0-9_]*)$/;

const isTemplate = (v: unknown) => typeof v === 'string' && v.includes('{{');

/** Client-side mirror of the server's action validation; returns the first problem, if any. */
export function actionsProblem(actions: AutomationAction[], itemLabel = t('setupAutomations.editor.item')): string | null {
  for (const [i, a] of actions.entries()) {
    const n = t('setupAutomations.editor.numbered', { label: itemLabel, n: i + 1 });
    const noFields = 'fields' in a && !Object.keys(a.fields ?? {}).length;
    switch (a.type) {
      case 'create_record':
        if (!a.object) return t('setupAutomations.problems.chooseObjectToCreate', { item: n });
        if (noFields) return t('setupAutomations.problems.addField', { item: n });
        break;
      case 'update_related':
        if (!a.lookupField) return t('setupAutomations.problems.chooseRelatedRecord', { item: n });
        if (noFields) return t('setupAutomations.problems.addField', { item: n });
        break;
      case 'update_record':
        if (noFields) return t('setupAutomations.problems.addField', { item: n });
        break;
      case 'notify':
        if (!RECIPIENT_RE.test(a.to)) return t('setupAutomations.problems.chooseRecipient', { item: n });
        if (!a.title.trim()) return t('setupAutomations.problems.enterNotificationTitle', { item: n });
        break;
      case 'run_agent':
        if (!a.agentId) return t('setupAutomations.problems.chooseAgent', { item: n });
        if (!a.prompt.trim()) return t('setupAutomations.problems.enterPrompt', { item: n });
        break;
      case 'webhook':
        if (!/^https?:\/\/\S+$/i.test(a.url)) return t('setupAutomations.problems.enterUrl', { item: n });
        break;
      case 'submit_approval':
        break;
    }
  }
  return null;
}
const initialValue = (f: FieldDef | undefined): unknown => (f?.type === 'checkbox' ? true : null);

/** Fields an action may set on records of `def` (calculated fields are excluded; the owner is allowed). */
function settableFields(def: ObjectDef): FieldDef[] {
  return [...def.fields.filter((f) => isEditable(def, f)), OWNER_FIELD];
}

/** Stable React keys for a controlled, reorderable list. */
function useStableKeys(length: number) {
  const seq = useRef(0);
  const keys = useRef<number[]>([]);
  if (keys.current.length !== length) {
    const next = keys.current.slice(0, length);
    while (next.length < length) next.push(seq.current++);
    keys.current = next;
  }
  return {
    keys: keys.current,
    add: () => {
      keys.current = [...keys.current, seq.current++];
    },
    remove: (i: number) => {
      keys.current = keys.current.filter((_, j) => j !== i);
    },
    swap: (i: number, j: number) => {
      const next = [...keys.current];
      [next[i], next[j]] = [next[j]!, next[i]!];
      keys.current = next;
    },
  };
}

function blankAction(type: AutomationActionType, object: ObjectDef, agentId: string): AutomationAction {
  switch (type) {
    case 'update_record':
      return { type, fields: {} };
    case 'update_related':
      return { type, lookupField: object.fields.find((f) => f.type === 'lookup')?.apiName ?? '', fields: {} };
    case 'create_record':
      return { type, object: '', fields: {} };
    case 'notify':
      return { type, to: 'owner', title: '', body: '' };
    case 'run_agent':
      return { type, agentId, prompt: '' };
    case 'webhook':
      return { type, url: '', method: 'POST' };
    case 'submit_approval':
      return { type, comment: '' };
  }
}

function TemplateHint({ object }: { object: ObjectDef }) {
  const lookup = object.fields.find((f) => f.type === 'lookup' && f.referenceTo !== '*');
  const code = (sample: string) => <code className="rounded bg-slate-100 px-1">{sample}</code>;
  const samples = {
    braces: code('{{ }}'),
    recordName: code('{{record.name}}'),
    previousValue: code('{{previous.<field>}}'),
    ownerName: code('{{owner.name}}'),
    userName: code('{{user.name}}'),
    formula: code('{{ADD_DAYS(TODAY(), 3)}}'),
  };
  return (
    <p className="text-xs text-slate-500">
      {lookup ? tx('setupAutomations.editor.templateHintRelated', { ...samples, relatedName: code(`{{related.${lookup.apiName}.name}}`) }) : tx('setupAutomations.editor.templateHint', samples)}
    </p>
  );
}

function useRecordName(referenceTo: string | null | undefined, id: unknown): string | null {
  const enabled = typeof id === 'string' && id !== '' && !id.includes('{{') && !!referenceTo && referenceTo !== '*';
  const q = useQuery({
    queryKey: ['setup-record-name', referenceTo, id],
    queryFn: () => api.get<RecordResponse>(`/api/records/${referenceTo}/${String(id)}`),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  return enabled ? (q.data?.record.name ?? null) : null;
}

function FieldValueRow({
  fields,
  used,
  apiName,
  value,
  onField,
  onValue,
  onRemove,
}: {
  fields: FieldDef[];
  used: Set<string>;
  apiName: string;
  value: unknown;
  onField: (apiName: string) => void;
  onValue: (v: unknown) => void;
  onRemove: () => void;
}) {
  const fieldId = useId();
  const valueId = useId();
  const f = fields.find((x) => x.apiName === apiName);
  const [tpl, setTpl] = useState(() => isTemplate(value));
  const refName = useRecordName(f?.type === 'lookup' ? f.referenceTo : null, value);
  const textual = !f || TEXTUAL.has(f.type);
  const str = value === null || value === undefined ? '' : String(value);

  return (
    <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
      <div className="w-full sm:w-52 sm:shrink-0">
        <label htmlFor={fieldId} className="sr-only">
          {t('common.field')}
        </label>
        <select
          id={fieldId}
          className="input"
          value={apiName}
          onChange={(e) => {
            setTpl(false);
            onField(e.target.value);
          }}
        >
          {!f && <option value={apiName}>{apiName}</option>}
          {fields
            .filter((x) => x.apiName === apiName || !used.has(x.apiName))
            .map((x) => (
              <option key={x.apiName} value={x.apiName}>
                {x.label}
              </option>
            ))}
        </select>
      </div>
      <div className="min-w-0 flex-1">
        <label htmlFor={valueId} className="sr-only">
          {t('setupAutomations.fieldValues.valueFor', { field: f?.label ?? apiName })}
        </label>
        {tpl || textual || !f ? (
          <input
            id={valueId}
            className={cx('input', tpl && 'font-mono text-xs')}
            placeholder={tpl ? '{{record.name}}' : t('setupAutomations.fieldValues.valuePlaceholder', { template: '{{template}}' })}
            value={str}
            onChange={(e) => onValue(e.target.value)}
          />
        ) : (
          <FieldInput id={valueId} field={f} value={value} refLabel={refName} onChange={onValue} />
        )}
      </div>
      {f && !textual && (
        <button
          type="button"
          aria-pressed={tpl}
          aria-label={t('setupAutomations.fieldValues.useFormulaFor', { field: f.label })}
          title={tpl ? t('setupAutomations.fieldValues.useFixedValue') : t('setupAutomations.fieldValues.useFormula')}
          onClick={() => {
            if (tpl) onValue(initialValue(f));
            else onValue(typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? String(value) : '');
            setTpl(!tpl);
          }}
          className={cx('inline-flex size-9 shrink-0 items-center justify-center rounded-lg border', tpl ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50')}
        >
          <Braces className="size-4" aria-hidden />
        </button>
      )}
      <IconButton icon={X} label={t('setupAutomations.fieldValues.remove', { field: f?.label ?? apiName })} className="mt-0.5" onClick={onRemove} />
    </div>
  );
}

/** Rows of "field = value" for update/create actions. Values may be literals or {{ }} templates. */
function FieldValues({ target, values, onChange }: { target: ObjectDef | undefined; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const entries = Object.entries(values ?? {});
  const rows = useStableKeys(entries.length);
  if (!target) return <p className="text-sm text-slate-500">{t('setupAutomations.fieldValues.chooseObjectFirst')}</p>;
  const fields = settableFields(target);
  const used = new Set(entries.map(([k]) => k));
  const free = fields.filter((f) => !used.has(f.apiName));

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div className="hidden gap-2 text-xs font-semibold text-slate-500 uppercase sm:flex">
          <span className="w-52 shrink-0">{t('common.field')}</span>
          <span>{t('common.value')}</span>
        </div>
      )}
      {entries.map(([k, v], i) => (
        <FieldValueRow
          key={rows.keys[i]}
          fields={fields}
          used={used}
          apiName={k}
          value={v}
          onField={(next) => {
            const nf = fields.find((x) => x.apiName === next);
            onChange(Object.fromEntries(entries.map(([ek, ev], j) => (j === i ? [next, initialValue(nf)] : [ek, ev]))));
          }}
          onValue={(nv) => onChange(Object.fromEntries(entries.map(([ek, ev], j) => (j === i ? [ek, nv] : [ek, ev]))))}
          onRemove={() => {
            rows.remove(i);
            onChange(Object.fromEntries(entries.filter((_, j) => j !== i)));
          }}
        />
      ))}
      {entries.length === 0 && <p className="text-sm text-slate-500">{t('setupAutomations.fieldValues.empty')}</p>}
      <Button
        size="sm"
        variant="ghost"
        icon={Plus}
        disabled={!free.length}
        onClick={() => {
          const f = free[0]!;
          rows.add();
          onChange({ ...values, [f.apiName]: initialValue(f) });
        }}
      >
        {t('setupAutomations.fieldValues.add')}
      </Button>
    </div>
  );
}

const RECIPIENT_KINDS = [
  { id: 'owner', label: 'setupAutomations.notify.recipients.owner' },
  { id: 'triggering_user', label: 'setupAutomations.notify.recipients.triggeringUser' },
  { id: 'user', label: 'setupAutomations.notify.recipients.user' },
  { id: 'role', label: 'setupAutomations.notify.recipients.role' },
  { id: 'field', label: 'setupAutomations.notify.recipients.field' },
] as const;
type RecipientKind = (typeof RECIPIENT_KINDS)[number]['id'];

function RecipientInput({ object, value, onChange }: { object: ObjectDef; value: string; onChange: (to: string) => void }) {
  const kindId = useId();
  const targetId = useId();
  const { isAdmin } = usePermissions();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDef[]>('/api/roles'), enabled: isAdmin, staleTime: 5 * 60_000 });
  const colon = value.indexOf(':');
  const kind = (colon >= 0 ? value.slice(0, colon) : value) as RecipientKind;
  const target = colon >= 0 ? value.slice(colon + 1) : '';
  const userFields = object.fields.filter((f) => f.type === 'user');

  const setKind = (k: RecipientKind) => {
    if (k === 'owner' || k === 'triggering_user') onChange(k);
    else if (k === 'field') onChange(`field:${userFields[0]?.apiName ?? ''}`);
    else if (k === 'role') onChange(`role:${roles.data?.[0]?.id ?? ''}`);
    else onChange('user:');
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={t('setupAutomations.notify.sendTo')} htmlFor={kindId} required>
        <select id={kindId} className="input" value={kind} onChange={(e) => setKind(e.target.value as RecipientKind)}>
          {RECIPIENT_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {t(k.label)}
            </option>
          ))}
        </select>
      </FormField>
      {kind === 'user' && (
        <FormField label={t('setupAutomations.notify.user')} htmlFor={targetId} required>
          <UserSelect id={targetId} value={target || null} emptyLabel={t('setupAutomations.notify.chooseUser')} onChange={(id) => onChange(`user:${id ?? ''}`)} />
        </FormField>
      )}
      {kind === 'role' &&
        (isAdmin ? (
          <FormField label={t('common.role')} htmlFor={targetId} required>
            <select id={targetId} className="input" value={target} onChange={(e) => onChange(`role:${e.target.value}`)}>
              {!target && <option value="">{t('setupAutomations.notify.chooseRole')}</option>}
              {target && !roles.data?.some((r) => r.id === target) && <option value={target}>{target}</option>}
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>
        ) : (
          <FormField label={t('setupAutomations.notify.roleId')} htmlFor={targetId} required help={t('setupAutomations.notify.roleIdHelp', { example: 'sales_manager' })}>
            <input id={targetId} className="input font-mono" value={target} onChange={(e) => onChange(`role:${e.target.value.trim()}`)} />
          </FormField>
        ))}
      {kind === 'field' && (
        <FormField label={t('setupAutomations.notify.userField')} htmlFor={targetId} required help={userFields.length ? t('setupAutomations.notify.userFieldHelp') : t('setupAutomations.notify.noUserFields', { object: object.label })}>
          <select id={targetId} className="input" value={target} onChange={(e) => onChange(`field:${e.target.value}`)}>
            {!userFields.some((f) => f.apiName === target) && <option value={target}>{target || '—'}</option>}
            {userFields.map((f) => (
              <option key={f.apiName} value={f.apiName}>
                {f.label}
              </option>
            ))}
          </select>
        </FormField>
      )}
    </div>
  );
}

function ActionBody({ object, action, onChange }: { object: ObjectDef; action: AutomationAction; onChange: (a: AutomationAction) => void }) {
  const ids = { a: useId(), b: useId(), c: useId() };
  const objects = useObjects();
  const agents = useAgents();
  const processes = useQuery({
    queryKey: ['approval-processes', object.apiName],
    queryFn: () => api.get<ApprovalProcessDef[]>(`/api/approval-processes${qs({ object: object.apiName })}`),
    enabled: action.type === 'submit_approval',
  });
  const [polyTarget, setPolyTarget] = useState<string | null>(null);
  const objectDef = (name: string | null | undefined) => (name ? objects.data?.find((o) => o.apiName === name) : undefined);

  switch (action.type) {
    case 'update_record':
      return (
        <div className="space-y-2">
          <FieldValues target={object} values={action.fields} onChange={(fields) => onChange({ ...action, fields })} />
          <TemplateHint object={object} />
        </div>
      );
    case 'update_related': {
      const lookups = object.fields.filter((f) => f.type === 'lookup');
      const lf = lookups.find((f) => f.apiName === action.lookupField);
      const polymorphic = lf?.referenceTo === '*';
      const guess = polymorphic ? (objects.data?.find((o) => Object.keys(action.fields ?? {}).every((k) => k === 'owner_id' || o.fields.some((f) => f.apiName === k)))?.apiName ?? null) : null;
      const targetApi = polymorphic ? (polyTarget ?? guess) : (lf?.referenceTo ?? null);
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('setupAutomations.updateRelated.relatedRecord')} htmlFor={ids.a} required help={lookups.length ? t('setupAutomations.updateRelated.relatedRecordHelp') : t('setupAutomations.updateRelated.noLookupFields', { object: object.label })}>
              <select
                id={ids.a}
                className="input"
                value={action.lookupField}
                onChange={(e) => {
                  const next = lookups.find((f) => f.apiName === e.target.value);
                  setPolyTarget(null);
                  onChange({ ...action, lookupField: e.target.value, fields: next?.referenceTo === lf?.referenceTo ? action.fields : {} });
                }}
              >
                {!lf && <option value={action.lookupField}>{action.lookupField || t('setupAutomations.updateRelated.chooseLookupField')}</option>}
                {lookups.map((f) => (
                  <option key={f.apiName} value={f.apiName}>
                    {f.label} → {f.referenceTo === '*' ? t('setupAutomations.updateRelated.anyObject') : (objectDef(f.referenceTo)?.label ?? f.referenceTo)}
                  </option>
                ))}
              </select>
            </FormField>
            {polymorphic && (
              <FormField label={t('setupAutomations.updateRelated.showFieldsOf')} htmlFor={ids.b} help={t('setupAutomations.updateRelated.showFieldsOfHelp')}>
                <select id={ids.b} className="input" value={targetApi ?? ''} onChange={(e) => setPolyTarget(e.target.value)}>
                  {!targetApi && <option value="">{t('setupAutomations.chooseObject')}</option>}
                  {objects.data?.map((o) => (
                    <option key={o.apiName} value={o.apiName}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>
          {lf && <FieldValues key={`${action.lookupField}:${targetApi ?? ''}`} target={objectDef(targetApi)} values={action.fields} onChange={(fields) => onChange({ ...action, fields })} />}
          <TemplateHint object={object} />
        </div>
      );
    }
    case 'create_record': {
      const target = objectDef(action.object);
      return (
        <div className="space-y-3">
          <FormField label={t('setupAutomations.createRecord.object')} htmlFor={ids.a} required help={t('setupAutomations.createRecord.objectHelp', { example: '{{record.id}}' })}>
            <select id={ids.a} className="input sm:w-72" value={action.object} onChange={(e) => onChange({ ...action, object: e.target.value, fields: {} })}>
              {!target && <option value={action.object}>{action.object || t('setupAutomations.chooseObject')}</option>}
              {objects.data?.map((o) => (
                <option key={o.apiName} value={o.apiName}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          {target && <FieldValues key={target.apiName} target={target} values={action.fields} onChange={(fields) => onChange({ ...action, fields })} />}
          <TemplateHint object={object} />
        </div>
      );
    }
    case 'notify':
      return (
        <div className="space-y-3">
          <RecipientInput object={object} value={action.to} onChange={(to) => onChange({ ...action, to })} />
          <FormField label={t('setupAutomations.notify.title')} htmlFor={ids.a} required>
            <input id={ids.a} className="input" placeholder={t('setupAutomations.notify.titlePlaceholder', { recordName: '{{record.name}}' })} value={action.title} onChange={(e) => onChange({ ...action, title: e.target.value })} />
          </FormField>
          <FormField label={t('setupAutomations.notify.message')} htmlFor={ids.b}>
            <textarea id={ids.b} className="input" rows={2} value={action.body ?? ''} onChange={(e) => onChange({ ...action, body: e.target.value })} />
          </FormField>
          <TemplateHint object={object} />
        </div>
      );
    case 'run_agent': {
      const list = agents.data ?? [];
      return (
        <div className="space-y-3">
          <FormField label={t('setupAutomations.runAgent.agent')} htmlFor={ids.a} required>
            <select id={ids.a} className="input sm:w-72" value={action.agentId} onChange={(e) => onChange({ ...action, agentId: e.target.value })}>
              {!list.some((a) => a.id === action.agentId) && <option value={action.agentId}>{action.agentId || t('setupAutomations.runAgent.chooseAgent')}</option>}
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.active ? a.name : t('setupAutomations.editor.inactiveOption', { name: a.name })}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('setupAutomations.runAgent.prompt')} htmlFor={ids.b} required help={t('setupAutomations.runAgent.promptHelp', { example: '{{record.name}}' })}>
            <textarea id={ids.b} className="input" rows={3} placeholder={t('setupAutomations.runAgent.promptPlaceholder')} value={action.prompt} onChange={(e) => onChange({ ...action, prompt: e.target.value })} />
          </FormField>
        </div>
      );
    }
    case 'webhook':
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <FormField label={t('setupAutomations.webhook.url')} htmlFor={ids.a} required help={t('setupAutomations.webhook.urlHelp')}>
            <input id={ids.a} type="url" className="input" placeholder="https://example.com/hooks/titoforce" value={action.url} onChange={(e) => onChange({ ...action, url: e.target.value.trim() })} />
          </FormField>
          <FormField label={t('setupAutomations.webhook.method')} htmlFor={ids.b}>
            <select id={ids.b} className="input" value={action.method ?? 'POST'} onChange={(e) => onChange({ ...action, method: e.target.value as 'POST' | 'PUT' })}>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
          </FormField>
        </div>
      );
    case 'submit_approval': {
      const list = processes.data ?? [];
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('setupAutomations.submitApproval.process')} htmlFor={ids.a} help={t('setupAutomations.submitApproval.processHelp')}>
            <select
              id={ids.a}
              className="input"
              value={action.processId ?? ''}
              onChange={(e) => {
                const { processId: _omit, ...rest } = action;
                onChange(e.target.value ? { ...rest, processId: e.target.value } : rest);
              }}
            >
              <option value="">{t('setupAutomations.submitApproval.automatic')}</option>
              {action.processId && !list.some((p) => p.id === action.processId) && <option value={action.processId}>{action.processId}</option>}
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.active ? p.name : t('setupAutomations.editor.inactiveOption', { name: p.name })}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('setupAutomations.submitApproval.comment')} htmlFor={ids.c} help={t('setupAutomations.submitApproval.commentHelp')}>
            <input id={ids.c} className="input" value={action.comment ?? ''} onChange={(e) => onChange({ ...action, comment: e.target.value })} />
          </FormField>
        </div>
      );
    }
  }
}

/** Editor for a list of automation actions (automations and approval-process steps). */
export function ActionsEditor({
  object,
  value,
  onChange,
  types = ALL_TYPES,
  emptyText = t('setupAutomations.editor.empty'),
  itemLabel = t('setupAutomations.editor.item'),
  addLabel = t('setupAutomations.editor.add'),
}: {
  object: ObjectDef;
  value: AutomationAction[];
  onChange: (v: AutomationAction[]) => void;
  /** Restricts the action types that can be chosen. */
  types?: AutomationActionType[];
  emptyText?: string;
  /** Accessible name of each action card, numbered — e.g. "On approve action" → "On approve action 2". */
  itemLabel?: string;
  /** Text of the add button; make it unique when several editors are shown together. */
  addLabel?: string;
}) {
  const baseId = useId();
  const agents = useAgents();
  const rows = useStableKeys(value.length);
  const firstAgent = (agents.data ?? []).find((a) => a.active)?.id ?? '';
  const set = (i: number, a: AutomationAction) => onChange(value.map((x, j) => (j === i ? a : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    rows.swap(i, j);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">{emptyText}</p>}
      {value.map((a, i) => {
        const typeId = `${baseId}-type-${i}`;
        const options = types.includes(a.type) ? types : [a.type, ...types];
        return (
          <fieldset key={rows.keys[i]} aria-label={t('setupAutomations.editor.numbered', { label: itemLabel, n: i + 1 })} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 rounded-t-xl border-b border-slate-100 bg-slate-50/70 px-3 py-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700" aria-hidden>
                {i + 1}
              </span>
              <label htmlFor={typeId} className="sr-only">
                {t('setupAutomations.editor.actionType')}
              </label>
              <select id={typeId} className="input w-auto min-w-52 py-1" value={a.type} onChange={(e) => set(i, blankAction(e.target.value as AutomationActionType, object, firstAgent))}>
                {options.map((type) => (
                  <option key={type} value={type}>
                    {ACTION_LABELS[type]}
                  </option>
                ))}
              </select>
              <div className="ml-auto flex items-center">
                <IconButton icon={ArrowUp} label={t('setupAutomations.editor.moveUp')} disabled={i === 0} className="disabled:opacity-30" onClick={() => move(i, -1)} />
                <IconButton icon={ArrowDown} label={t('setupAutomations.editor.moveDown')} disabled={i === value.length - 1} className="disabled:opacity-30" onClick={() => move(i, 1)} />
                <IconButton
                  icon={Trash}
                  label={t('setupAutomations.editor.remove')}
                  className="hover:text-rose-600"
                  onClick={() => {
                    rows.remove(i);
                    onChange(value.filter((_, j) => j !== i));
                  }}
                />
              </div>
            </div>
            <div className="p-3">
              <ActionBody object={object} action={a} onChange={(next) => set(i, next)} />
            </div>
          </fieldset>
        );
      })}
      {value.length < 20 && (
        <Popover
          className="w-60 py-1"
          trigger={({ toggle, open }) => (
            <Button size="sm" icon={Plus} aria-expanded={open} onClick={toggle}>
              {addLabel}
            </Button>
          )}
        >
          {(close) =>
            types.map((type) => (
              <MenuItem
                key={type}
                onClick={() => {
                  rows.add();
                  onChange([...value, blankAction(type, object, firstAgent)]);
                  close();
                }}
              >
                {ACTION_LABELS[type]}
              </MenuItem>
            ))
          }
        </Popover>
      )}
    </div>
  );
}

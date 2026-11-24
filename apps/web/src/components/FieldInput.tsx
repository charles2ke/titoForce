import type { FieldDef, QueryResponse, RecordResponse, SearchResultGroup } from '@titoforce/shared';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, qs } from '../api.ts';
import { inSentence, t } from '../i18n/index.ts';
import { useDebounced, useObjects, useUsers } from '../lib/hooks.ts';
import { cx } from './ui.tsx';

type Option = { id: string; name: string; subtitle?: string; object?: string };

/** Record picker: searches the target object (or every object for polymorphic lookups). */
export function LookupInput({
  referenceTo,
  value,
  label,
  onChange,
  id,
  invalid,
  placeholder,
}: {
  referenceTo: string;
  value: string | null;
  label?: string | null;
  onChange: (id: string | null, name?: string) => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<string | null>(label ?? null);
  const term = useDebounced(text.trim());
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const objects = useObjects();
  const target = objects.data?.find((o) => o.apiName === referenceTo);

  useEffect(() => setChosen(label ?? null), [label]);

  const results = useQuery({
    queryKey: ['lookup-search', referenceTo, term],
    enabled: open,
    queryFn: async (): Promise<Option[]> => {
      if (referenceTo === '*') {
        if (!term) return [];
        const groups = await api.get<SearchResultGroup[]>(`/api/search${qs({ q: term, limit: 4 })}`);
        return groups.flatMap((g) => g.records.map((r) => ({ id: r.id, name: r.name, subtitle: g.label, object: g.object })));
      }
      const res = await api.post<QueryResponse>(`/api/records/${referenceTo}/query`, { q: term || undefined, pageSize: 8, sort: term ? null : { field: 'updated_at', dir: 'desc' } });
      return res.records.map((r) => ({ id: r.id, name: r.name }));
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Ids set without a display name (e.g. filters from a link) are resolved once.
  const resolved = useQuery({
    queryKey: ['lookup-name', value],
    enabled: !!value && !chosen,
    queryFn: () => api.get<RecordResponse>(`/api/lookup/${encodeURIComponent(value!)}`),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const options = results.data ?? [];
  const pick = (o: Option) => {
    setChosen(o.name);
    onChange(o.id, o.name);
    setText('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className={cx('input flex items-center justify-between gap-2', invalid && 'border-rose-400')}>
        <span className="truncate">{chosen ?? resolved.data?.record.name ?? (resolved.isLoading ? t('common.loading') : t('components.lookup.selected'))}</span>
        <button type="button" aria-label={t('components.lookup.clear')} className="text-slate-400 hover:text-slate-600" onClick={() => onChange(null)}>
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-slate-400" />
      <input
        id={id}
        className={cx('input pl-8', invalid && 'border-rose-400')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        placeholder={placeholder ?? (referenceTo === '*' ? t('components.lookup.searchAny') : target ? t('components.lookup.searchObject', { objects: inSentence(target.pluralLabel) }) : t('components.lookup.searchRecords'))}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            pick(options[active]);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.isLoading && <li className="px-3 py-2 text-sm text-slate-400">{t('components.lookup.searching')}</li>}
          {!results.isLoading && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">{referenceTo === '*' && !term ? t('components.lookup.typeToSearch') : t('components.lookup.noMatches')}</li>}
          {options.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx('cursor-pointer px-3 py-1.5 text-sm', i === active ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700')}
            >
              {o.name}
              {o.subtitle && <span className="ml-2 text-xs text-slate-400">{o.subtitle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UserSelect({ value, onChange, id, invalid, allowEmpty = true, emptyLabel = '—' }: { value: string | null; onChange: (id: string | null) => void; id?: string; invalid?: boolean; allowEmpty?: boolean; emptyLabel?: string }) {
  const users = useUsers();
  const list = (users.data ?? []).filter((u) => (u.active && !u.isAgent) || u.id === value);
  return (
    <select id={id} className={cx('input', invalid && 'border-rose-400')} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {u.title ? ` · ${u.title}` : ''}
        </option>
      ))}
    </select>
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Editor control for any editable field type. Empty values are reported as null. */
/** `onChange` also gets the display name of a picked lookup record. */
export function FieldInput({
  field,
  value,
  onChange,
  refLabel,
  id,
  invalid,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown, label?: string) => void;
  refLabel?: string | null;
  id?: string;
  invalid?: boolean;
}) {
  const cls = cx('input', invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20');
  const str = value === null || value === undefined ? '' : String(value);
  switch (field.type) {
    case 'longtext':
      return <textarea id={id} className={cls} rows={4} value={str} onChange={(e) => onChange(e.target.value || null)} />;
    case 'number':
    case 'currency':
    case 'percent':
      return (
        <div className="relative">
          {field.type === 'currency' && <span className="pointer-events-none absolute top-1.5 left-3 text-sm text-slate-400">$</span>}
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step={field.precision === 0 ? 1 : 'any'}
            className={cx(cls, field.type === 'currency' && 'pl-6', field.type === 'percent' && 'pr-7')}
            value={str}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
          {field.type === 'percent' && <span className="pointer-events-none absolute top-1.5 right-3 text-sm text-slate-400">%</span>}
        </div>
      );
    case 'date':
      return <input id={id} type="date" className={cls} value={str.slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return <input id={id} type="datetime-local" className={cls} value={str ? toLocalInput(str) : ''} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
    case 'checkbox':
      return (
        <div className="flex h-9 items-center">
          <input id={id} type="checkbox" className="size-4 rounded border-slate-300 accent-indigo-600" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        </div>
      );
    case 'picklist':
      return (
        <select id={id} className={cls} value={str} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label ?? o.value}
            </option>
          ))}
          {str && !field.options?.some((o) => o.value === str) && <option value={str}>{str}</option>}
        </select>
      );
    case 'multipicklist': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div id={id} className="flex flex-wrap gap-1.5">
          {field.options?.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? selected.filter((v) => v !== o.value) : [...selected, o.value];
                  onChange(next.length ? next : null);
                }}
                className={cx('rounded-full border px-2.5 py-1 text-xs font-medium', on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
              >
                {o.label ?? o.value}
              </button>
            );
          })}
        </div>
      );
    }
    case 'lookup':
      return <LookupInput id={id} invalid={invalid} referenceTo={field.referenceTo ?? '*'} value={str || null} label={refLabel} onChange={onChange} />;
    case 'user':
      return <UserSelect id={id} invalid={invalid} value={str || null} onChange={onChange} />;
    case 'email':
      return <input id={id} type="email" className={cls} value={str} onChange={(e) => onChange(e.target.value || null)} />;
    case 'phone':
      return <input id={id} type="tel" className={cls} value={str} onChange={(e) => onChange(e.target.value || null)} />;
    case 'url':
      return <input id={id} type="text" inputMode="url" placeholder="https://" className={cls} value={str} onChange={(e) => onChange(e.target.value || null)} />;
    default:
      return <input id={id} type="text" className={cls} value={str} onChange={(e) => onChange(e.target.value || null)} />;
  }
}

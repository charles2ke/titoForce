import type { TranslationCategory, TranslationEntry } from '@titoforce/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Languages, Search, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useToast } from '../../components/feedback.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, IconButton, Loading, PageHeader, Pagination } from '../../components/ui.tsx';
import { getLocale, LOCALES, type Locale, t } from '../../i18n/index.ts';
import { invalidateMetadata, useObjects } from '../../lib/hooks.ts';
import { useUnsavedChanges } from '../../lib/unsaved.ts';

const PAGE_SIZE = 50;
const TARGETS = LOCALES.filter((l) => l.code !== 'en');
const TYPES: TranslationCategory[] = ['object', 'field', 'picklist', 'layout', 'app'];
const TYPE_COLOR: Record<TranslationCategory, string> = { object: 'indigo', field: 'blue', picklist: 'teal', layout: 'purple', app: 'orange' };
const STATUSES = ['all', 'missing', 'custom', 'builtIn'] as const;
type Status = (typeof STATUSES)[number];

function matchesStatus(e: TranslationEntry, status: Status): boolean {
  if (status === 'missing') return !e.value && !e.builtIn;
  if (status === 'custom') return !!e.value;
  if (status === 'builtIn') return !e.value && !!e.builtIn;
  return true;
}

function EntryRow({ entry, value, changed, language, onChange }: { entry: TranslationEntry; value: string; changed: boolean; language: Locale; onChange: (v: string) => void }) {
  const hintId = useId();
  const builtInShown = !value.trim() && !!entry.builtIn;
  const props = {
    className: 'input',
    value,
    lang: language,
    maxLength: 1000,
    placeholder: entry.builtIn ?? entry.source,
    'aria-label': t('setupTranslations.translationOf', { label: entry.source }),
    'aria-describedby': builtInShown ? hintId : undefined,
  };
  return (
    <tr className={cx(changed ? 'bg-amber-50/60' : 'hover:bg-slate-50/70')}>
      <td className="px-4 py-2.5 align-top">
        <div className="break-words text-slate-900">{entry.source}</div>
        <div className="mt-0.5 text-xs break-words text-slate-500">{entry.context}</div>
      </td>
      <td className="hidden px-4 py-2.5 align-top sm:table-cell">
        <Badge color={TYPE_COLOR[entry.category]}>{t(`setupTranslations.typeBadge.${entry.category}`)}</Badge>
      </td>
      <td className="px-4 py-2 align-top">
        <div className="flex items-start gap-1">
          {entry.source.length > 80 ? <textarea rows={2} {...props} onChange={(e) => onChange(e.target.value)} /> : <input {...props} onChange={(e) => onChange(e.target.value)} />}
          {value && <IconButton icon={X} label={t('setupTranslations.reset')} className="mt-1 size-7 shrink-0" onClick={() => onChange('')} />}
        </div>
        {builtInShown && (
          <p id={hintId} className="mt-1 text-xs text-slate-400">
            {t('setupTranslations.builtInHint')}
          </p>
        )}
      </td>
    </tr>
  );
}

/** Setup → Translations: labels of objects, fields, picklist values, layout sections and apps in each supported language. */
export default function Translations() {
  const qc = useQueryClient();
  const toast = useToast();
  const objects = useObjects();
  const ids = { language: useId(), type: useId(), object: useId(), status: useId() };
  const [language, setLanguage] = useState<Locale>(() => (getLocale() === 'en' ? TARGETS[0]!.code : getLocale()));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [type, setType] = useState<TranslationCategory | 'all'>('all');
  const [object, setObject] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const entries = useQuery({ queryKey: ['translations', language], queryFn: () => api.get<TranslationEntry[]>(`/api/translations?locale=${language}`) });
  const list = useMemo(() => entries.data ?? [], [entries.data]);
  const changes = list.filter((e) => e.key in edits && edits[e.key]!.trim() !== (e.value ?? ''));
  const confirmDiscard = useUnsavedChanges(changes.length > 0);

  const objectOptions = useMemo(() => {
    const names = [...new Set(list.map((e) => e.object).filter((o): o is string => !!o))];
    return names.map((api) => ({ api, label: objects.data?.find((o) => o.apiName === api)?.pluralLabel ?? api })).sort((a, b) => a.label.localeCompare(b.label));
  }, [list, objects.data]);

  const term = q.trim().toLowerCase();
  const filtered = list.filter(
    (e) =>
      (type === 'all' || e.category === type) &&
      (!object || e.object === object) &&
      matchesStatus(e, status) &&
      (!term || [e.source, e.context, e.value ?? '', e.builtIn ?? ''].some((s) => s.toLowerCase().includes(term))),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const done = list.filter((e) => e.value || e.builtIn).length;
  const languageName = TARGETS.find((l) => l.code === language)?.name ?? language;

  const save = useMutation({
    mutationFn: (payload: { key: string; value: string | null }[]) => api.put<TranslationEntry[]>(`/api/translations/${language}`, { entries: payload }),
    onSuccess: async (next, payload) => {
      qc.setQueryData(['translations', language], next);
      // Keep edits typed while saving.
      setEdits((cur) => {
        const out = { ...cur };
        for (const e of payload) if ((out[e.key] ?? '').trim() === (e.value ?? '')) delete out[e.key];
        return out;
      });
      toast.success(t('setupTranslations.saved', { count: payload.length }));
      await invalidateMetadata(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  const changeLanguage = async (next: Locale) => {
    if (!(await confirmDiscard())) return;
    setEdits({});
    setLanguage(next);
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title={t('setupTranslations.title')} subtitle={t('setupTranslations.subtitle')}>
        <p className="mt-1 text-xs text-slate-400">{t('setupTranslations.englishBase')}</p>
      </PageHeader>

      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3">
          <div>
            <label htmlFor={ids.language} className="label">
              {t('setupTranslations.language')}
            </label>
            <select id={ids.language} className="input w-40" value={language} onChange={(e) => void changeLanguage(e.target.value as Locale)}>
              {TARGETS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.type} className="label">
              {t('setupTranslations.type')}
            </label>
            <select id={ids.type} className="input w-48" value={type} onChange={(e) => filter(setType)(e.target.value as TranslationCategory | 'all')}>
              <option value="all">{t('setupTranslations.types.all')}</option>
              {TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`setupTranslations.types.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.object} className="label">
              {t('setupTranslations.object')}
            </label>
            <select id={ids.object} className="input w-48" value={object} onChange={(e) => filter(setObject)(e.target.value)}>
              <option value="">{t('setupTranslations.allObjects')}</option>
              {objectOptions.map((o) => (
                <option key={o.api} value={o.api}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.status} className="label">
              {t('setupTranslations.show')}
            </label>
            <select id={ids.status} className="input w-48" value={status} onChange={(e) => filter(setStatus)(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`setupTranslations.statuses.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" aria-hidden />
            <input type="search" aria-label={t('setupTranslations.search')} placeholder={t('setupTranslations.searchPlaceholder')} className="input pl-8" value={q} onChange={(e) => filter(setQ)(e.target.value)} />
          </div>
        </div>

        {entries.isLoading ? (
          <Loading />
        ) : entries.error ? (
          <div className="p-4">
            <ErrorBanner error={entries.error} />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 pt-3 text-xs text-slate-500">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${list.length ? Math.round((done / list.length) * 100) : 0}%` }} />
              </div>
              <span>{t('setupTranslations.progress', { done, count: list.length })}</span>
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={Languages} title={t('setupTranslations.noMatches')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="mt-2 w-full table-fixed text-sm">
                  <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 uppercase">
                    <tr>
                      <th className="w-[38%] px-4 py-2.5">{t('setupTranslations.columns.label')}</th>
                      <th className="hidden w-36 px-4 py-2.5 sm:table-cell">{t('setupTranslations.columns.type')}</th>
                      <th className="px-4 py-2.5">{t('setupTranslations.columns.translation', { language: languageName })}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((e) => (
                      <EntryRow
                        key={e.key}
                        entry={e}
                        language={language}
                        value={edits[e.key] ?? e.value ?? ''}
                        changed={e.key in edits && edits[e.key]!.trim() !== (e.value ?? '')}
                        onChange={(v) => setEdits((cur) => ({ ...cur, [e.key]: v }))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={current} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
          </>
        )}

        {changes.length > 0 && (
          <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <span className="mr-auto text-sm text-slate-600">{t('setupTranslations.unsaved', { count: changes.length })}</span>
            <Button disabled={save.isPending} onClick={() => setEdits({})}>
              {t('setupTranslations.discard')}
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(changes.map((e) => ({ key: e.key, value: edits[e.key]!.trim() || null })))}>
              {t('setupTranslations.save')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

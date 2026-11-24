import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Info, Target, TrendingUp, Trophy, UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSearchParams } from 'react-router';
import { api } from '../api.ts';
import { Card, cx, ErrorBanner, Loading } from '../components/ui.tsx';
import { intlLocale, type MessageKey, t } from '../i18n/index.ts';
import { formatCompact, formatNumber } from '../lib/format.ts';
import { useObjectDef } from '../lib/hooks.ts';

interface ForecastRow {
  key: string;
  label: string;
  pipeline: number;
  bestCase: number;
  commit: number;
  weighted: number;
  closedWon: number;
  count: number;
}

const SERIES: { key: keyof ForecastRow; label: MessageKey; color: string }[] = [
  { key: 'closedWon', label: 'forecast.measures.closedWon', color: '#10b981' },
  { key: 'commit', label: 'forecast.measures.commit', color: '#6366f1' },
  { key: 'bestCase', label: 'forecast.measures.bestCase', color: '#0ea5e9' },
  { key: 'pipeline', label: 'forecast.measures.openPipeline', color: '#cbd5e1' },
];

const money = (n: number) => formatNumber(n, 'currency', 0);

/** Month rows are keyed `YYYY-MM`; their label is formatted in the UI language. */
function monthLabel(key: string): string | undefined {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? new Intl.DateTimeFormat(intlLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : undefined;
}

function Kpi({ label, value, hint, icon: IconCmp, tone }: { label: string; value: string; hint?: string; icon: typeof Target; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className={cx('grid size-6 place-items-center rounded-md', tone)}>
          <IconCmp className="size-3.5" aria-hidden />
        </span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export default function Forecast() {
  const [params, setParams] = useSearchParams();
  const groupBy = params.get('by') === 'owner' ? 'owner' : 'month';
  const months = [3, 6, 12].includes(Number(params.get('months'))) ? Number(params.get('months')) : 6;
  const { def } = useObjectDef('opportunity');
  const q = useQuery({
    queryKey: ['forecast', groupBy, months],
    queryFn: () => api.get<{ rows: ForecastRow[]; totals: ForecastRow; truncated: boolean; matchingCount: number }>(`/api/forecast?groupBy=${groupBy}&months=${months}`),
  });
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };
  const totals = q.data?.totals;
  const rows = useMemo(() => (q.data?.rows ?? []).map((r) => (groupBy === 'month' ? { ...r, label: monthLabel(r.key) ?? r.label } : r)), [q.data, groupBy]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('forecast.title')}</h1>
          <p className="text-sm text-slate-500">{t('forecast.subtitle', { objects: def?.pluralLabel ?? t('forecast.opportunities'), count: months })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t('forecast.groupBy')} className="flex rounded-lg bg-slate-100 p-0.5">
            {(
              [
                { id: 'month', label: t('forecast.byMonth'), icon: CalendarDays },
                { id: 'owner', label: t('forecast.byOwner'), icon: UsersRound },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={groupBy === o.id}
                onClick={() => set({ by: o.id })}
                className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', groupBy === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
              >
                <o.icon className="size-3.5" aria-hidden />
                {o.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            {t('forecast.window')}
            <select className="input h-8 w-auto py-0 text-sm" value={months} onChange={(e) => set({ months: e.target.value })}>
              {[3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {t('forecast.monthCount', { count: m })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBanner error={q.error} />
      ) : totals ? (
        <>
          {q.data?.truncated && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {t('forecast.truncated', { shown: totals.count, total: q.data.matchingCount })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5">
            <Kpi label={t('forecast.measures.closedWon')} value={money(totals.closedWon)} icon={Trophy} tone="bg-emerald-100 text-emerald-700" />
            <Kpi label={t('forecast.measures.commit')} value={money(totals.commit)} hint={t('forecast.hints.commit')} icon={Target} tone="bg-indigo-100 text-indigo-700" />
            <Kpi label={t('forecast.measures.bestCase')} value={money(totals.bestCase)} hint={t('forecast.hints.bestCase')} icon={TrendingUp} tone="bg-sky-100 text-sky-700" />
            <Kpi label={t('forecast.measures.openPipeline')} value={money(totals.pipeline)} hint={t('forecast.hints.weighted', { amount: formatCompact(totals.weighted, 'currency') })} icon={TrendingUp} tone="bg-slate-200 text-slate-700" />
            <Kpi label={t('forecast.opportunities')} value={totals.count.toLocaleString(intlLocale())} hint={t('forecast.hints.opportunities')} icon={CalendarDays} tone="bg-amber-100 text-amber-700" />
          </div>

          <Card title={groupBy === 'month' ? t('forecast.byCloseMonth') : t('forecast.byOwner')}>
            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">{t('forecast.empty')}</p>
            ) : (
              <div style={{ height: 320 }} role="img" aria-label={groupBy === 'month' ? t('forecast.chartByMonth') : t('forecast.chartByOwner')}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={(v: number) => formatCompact(v, 'currency')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip formatter={(v, name) => [money(Number(v)), String(name)]} contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      iconType="circle"
                      itemSorter={(item) => SERIES.findIndex((s) => s.key === item.dataKey)}
                      formatter={(value: string) => <span className="text-slate-600">{value}</span>}
                    />
                    {SERIES.map((s) => (
                      <Bar key={s.key} dataKey={s.key} name={t(s.label)} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={28} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card title={t('forecast.breakdown')} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">{groupBy === 'month' ? t('forecast.columns.closeMonth') : t('common.owner')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('forecast.columns.count')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('forecast.measures.closedWon')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('forecast.measures.commit')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('forecast.measures.bestCase')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('forecast.measures.openPipeline')}</th>
                    <th className="px-4 py-2 text-right font-medium">{t('forecast.measures.weighted')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {rows.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2 font-medium text-slate-800">{r.label}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{r.count.toLocaleString(intlLocale())}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{money(r.closedWon)}</td>
                      <td className="px-3 py-2 text-right">{money(r.commit)}</td>
                      <td className="px-3 py-2 text-right">{money(r.bestCase)}</td>
                      <td className="px-3 py-2 text-right">{money(r.pipeline)}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{money(r.weighted)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 font-semibold tabular-nums">
                    <td className="px-4 py-2">{t('common.total')}</td>
                    <td className="px-3 py-2 text-right">{totals.count.toLocaleString(intlLocale())}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{money(totals.closedWon)}</td>
                    <td className="px-3 py-2 text-right">{money(totals.commit)}</td>
                    <td className="px-3 py-2 text-right">{money(totals.bestCase)}</td>
                    <td className="px-3 py-2 text-right">{money(totals.pipeline)}</td>
                    <td className="px-4 py-2 text-right">{money(totals.weighted)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{t('forecast.footnote')}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}

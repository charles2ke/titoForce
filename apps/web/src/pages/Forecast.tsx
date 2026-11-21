import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Info, Target, TrendingUp, Trophy, UsersRound } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSearchParams } from 'react-router';
import { api } from '../api.ts';
import { Card, cx, ErrorBanner, Loading } from '../components/ui.tsx';
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

const SERIES: { key: keyof ForecastRow; label: string; color: string }[] = [
  { key: 'closedWon', label: 'Closed won', color: '#10b981' },
  { key: 'commit', label: 'Commit', color: '#6366f1' },
  { key: 'bestCase', label: 'Best case', color: '#0ea5e9' },
  { key: 'pipeline', label: 'Open pipeline', color: '#cbd5e1' },
];

const money = (n: number) => formatNumber(n, 'currency', 0);

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
  const t = q.data?.totals;
  const rows = q.data?.rows ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Sales forecast</h1>
          <p className="text-sm text-slate-500">
            {def?.pluralLabel ?? 'Opportunities'} closing in the next {months} months (from the start of this month).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Group by" className="flex rounded-lg bg-slate-100 p-0.5">
            {(
              [
                { id: 'month', label: 'By month', icon: CalendarDays },
                { id: 'owner', label: 'By owner', icon: UsersRound },
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
            Window
            <select className="input h-8 w-auto py-0 text-sm" value={months} onChange={(e) => set({ months: e.target.value })}>
              {[3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m} months
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
      ) : t ? (
        <>
          {q.data?.truncated && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Partial forecast: showing {t.count.toLocaleString()} of {q.data.matchingCount.toLocaleString()} matching opportunities. All figures below exclude the remaining opportunities.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5">
            <Kpi label="Closed won" value={money(t.closedWon)} icon={Trophy} tone="bg-emerald-100 text-emerald-700" />
            <Kpi label="Commit" value={money(t.commit)} hint="Open, likely to close" icon={Target} tone="bg-indigo-100 text-indigo-700" />
            <Kpi label="Best case" value={money(t.bestCase)} hint="Includes commit" icon={TrendingUp} tone="bg-sky-100 text-sky-700" />
            <Kpi label="Open pipeline" value={money(t.pipeline)} hint={`Weighted ${formatCompact(t.weighted, 'currency')}`} icon={TrendingUp} tone="bg-slate-200 text-slate-700" />
            <Kpi label="Opportunities" value={t.count.toLocaleString()} hint="Open and closed" icon={CalendarDays} tone="bg-amber-100 text-amber-700" />
          </div>

          <Card title={groupBy === 'month' ? 'By close month' : 'By owner'}>
            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No opportunities close in this window.</p>
            ) : (
              <div style={{ height: 320 }} role="img" aria-label={`Forecast chart ${groupBy === 'month' ? 'by close month' : 'by owner'}`}>
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
                      <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={28} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card title="Breakdown" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">{groupBy === 'month' ? 'Close month' : 'Owner'}</th>
                    <th className="px-3 py-2 text-right font-medium"># Opps</th>
                    <th className="px-3 py-2 text-right font-medium">Closed won</th>
                    <th className="px-3 py-2 text-right font-medium">Commit</th>
                    <th className="px-3 py-2 text-right font-medium">Best case</th>
                    <th className="px-3 py-2 text-right font-medium">Open pipeline</th>
                    <th className="px-4 py-2 text-right font-medium">Weighted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {rows.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2 font-medium text-slate-800">{r.label}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{r.count.toLocaleString()}</td>
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
                    <td className="px-4 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{t.count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{money(t.closedWon)}</td>
                    <td className="px-3 py-2 text-right">{money(t.commit)}</td>
                    <td className="px-3 py-2 text-right">{money(t.bestCase)}</td>
                    <td className="px-3 py-2 text-right">{money(t.pipeline)}</td>
                    <td className="px-4 py-2 text-right">{money(t.weighted)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Open pipeline counts every open opportunity. Commit = forecast category “Commit” or probability ≥ 75%. Best case = commit plus forecast category “Best Case” or probability ≥ 50%. Weighted = amount × probability. Only
              opportunities you can see are included.
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}
